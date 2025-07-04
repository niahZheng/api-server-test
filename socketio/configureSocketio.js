const socketIO = require('socket.io')
const { createAdapter } = require("@socket.io/postgres-adapter")
const debug = require('debug')('configureSocketIo')
const { instrument } = require("@socket.io/admin-ui");
const redis = require('redis');
const AssistantV2 = require('ibm-watson/assistant/v2')
const { IamAuthenticator } = require('ibm-watson/auth');

const celeryClient = require('../celery/celeryClient')

// 创建 Redis 客户端
const redisClient = redis.createClient({
    url: `rediss://default:${process.env.REDIS_PASSWORD}@rx-redis.redis.cache.windows.net:6380/1?ssl_cert_reqs=none`
});

// 连接 Redis
redisClient.connect().catch(console.error);

// In the constructor, letting the SDK manage the token
let assistant;
try {
    if (!process.env.WATSONX_ORCHESTRATOR_API_KEY) {
        throw new Error('WATSONX_ORCHESTRATOR_API_KEY environment variable is not set');
    }
    
    assistant = new AssistantV2({
        version: '2024-08-25',
        authenticator: new IamAuthenticator({
          apikey: process.env.WATSONX_ORCHESTRATOR_API_KEY,
        }),
        serviceUrl: 'https://api.us-south.assistant.watson.cloud.ibm.com/instances/1234567890',
    });
    
    console.log('Watson Assistant initialized successfully');
} catch (error) {
    console.error('Failed to initialize Watson Assistant:', error.message);
    assistant = null;
}

exports.configureSocketIo = function (server, pool, authenticateRequests) {
    // Set up Socket.IO with a specific path where WSS will connect to
    // this would be like ws://localhost:8000/socket.io
    io = socketIO(server, {
        path: '/socket.io',
        cors: {
            origin: "*",  // 允许所有域名访问
            methods: ["GET", "POST"],
            credentials: true
        },
        // 配置默认命名空间
        namespace: '/',
        // 允许所有连接默认进入根命名空间
        allowEIO3: true,
        transports: ['polling', 'websocket']
    });

    // 配置 Socket.IO Admin UI
    instrument(io, {
        auth: false,  // 禁用认证
        mode: "development",
        namespaceName: "/",  // 监控根命名空间
        readonly: false,
        serverId: "api-server",
        path: "/admin"  // Admin UI 的访问路径
    });

    console.log('\n=== Socket.IO Admin UI ===');
    console.log('Admin UI is available at: http://localhost:8000/admin');
    console.log('Authentication is disabled');
    console.log('Mode:', "development");
    console.log('Namespace:', "/");
    console.log('===========================\n');

    if (pool) {
        io.adapter(createAdapter(pool, {
            tableName: 'data.socket_io_attachments',
        }));
    }

    // Handle client connections in root namespace
    io.on('connection', (socket) => {

        // 加入房间
        socket.on('joinRoom', async (roomName, callback) => {
            try {
                // 确保房间名称不包含引号
                const cleanRoomName = roomName.replace(/"/g, '');
                const conversationid = cleanRoomName // see if we can get the room from the socket

                // 检查房间是否存在
                const room = io.sockets.adapter.rooms.get(cleanRoomName);
                if (!room) {
                    console.log(`Room ${cleanRoomName} does not exist, creating it...`);
                }

                // 加入房间
                socket.join(cleanRoomName);

                try {
                    await redisClient.set(conversationid + '_idv', JSON.stringify({
                        "conversationId": conversationid,
                        "identified": "unidentified",
                        "verified": "unverified",
                        "message": null,
                        "history_messages": null,
                        "pre_intent": "OrderStatus"
                    }));
                    console.log('Initial customer status identified&verified:', conversationid + '_idv');
                }
                catch (error) {
                    console.error('Error initial customer status identified&verified:', error);
                }                

                if (typeof callback === 'function') {
                    callback({
                        status: 'ok',
                        message: `Successfully joined room ${cleanRoomName}`,
                        socketId: socket.id,
                        roomCreated: !room,  // 添加标志表示房间是否是新创建的
                        roomSize: room ? room.size : 1  // 添加房间大小信息
                    });
                }
            } catch (error) {
                console.error('Error joining room:', error);
                if (typeof callback === 'function') {
                    callback({
                        status: 'error',
                        message: `Failed to join room: ${error.message}`
                    });
                }
            }
        });

        // Handle custom events from web UI
        // Like next best action clicks
        socket.on('webUiMessage', (data) => {
            // Do something with the event data
            console.log('\n=== Received webUiMessage ===');
            console.log('Socket ID:', socket.id);

            // whenever the UI sends a payload over via socketio, we will create a new celery task to process it
            const conversationid = [...socket.rooms][1] // see if we can get the room from the socket
            const parsed = JSON.parse(data)
            const payload = {
                type: "manual_completion",
                parameters: {
                    text: parsed.text
                },
                conversationid: conversationid// get the room id
            }
            console.log('Processing payload:', payload);
            // topic, payload (string)
            celeryClient
                .createTask("aan_extensions.NextBestActionAgent.tasks.process_transcript")
                .applyAsync([parsed.destination, JSON.stringify(payload)]);
        });

        // 获取当前所有房间
        socket.on('getRooms', (callback) => {
            const rooms = Array.from(io.sockets.adapter.rooms.keys());
            console.log('All rooms:', rooms);
            if (typeof callback === 'function') {
                callback({ rooms });
            }
        });

        // 离开房间
        socket.on('leaveRoom', (roomName, callback) => {
            try {
                console.log(`\n=== Leaving Room ===`);
                console.log(`Socket ${socket.id} attempting to leave room ${roomName}`);
                socket.leave(roomName);

                const currentRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
                console.log('Current rooms after leave:', currentRooms);

                if (typeof callback === 'function') {
                    callback({
                        status: 'ok',
                        message: `Successfully left room ${roomName}`,
                        rooms: currentRooms
                    });
                }
            } catch (error) {
                console.error('Error leaving room:', error);
                if (typeof callback === 'function') {
                    callback({
                        status: 'error',
                        message: `Failed to leave room: ${error.message}`
                    });
                }
            }
        });

        socket.conn.once("upgrade", () => {
            console.log('\n=== Transport Upgraded ===');
            console.log('Socket ID:', socket.id);
            console.log('New Transport:', socket.conn.transport.name);
            console.log('========================\n');
        });

        // celeryMessage is emitted from python celery workers who complete a task
        // the data is routed to a specific agent's room
        socket.on("celeryMessage", (data) => {
            console.log('\n=== Received celeryMessage ===');
            console.log('Data:', data);
            try {
                // 解析消息数据
                const messageData = typeof data === 'string' ? JSON.parse(data) : data;
                
                // 解析 payloadString
                let payload;
                if (messageData.payloadString) {
                    try {
                        payload = JSON.parse(messageData.payloadString);
                    } catch (e) {
                        console.error('Error parsing payloadString:', e);
                        return;
                    }
                } else {
                    payload = messageData;
                }

                console.log(`Emitting message to room ${payload.conversationid} on Socket ${socket.id}`);
                // Emits the message to the correct room "conversationid"
                io.to(payload.conversationid).emit('celeryMessage', messageData);
            } catch (error) {
                console.error('Error processing celeryMessage:', error);
                console.error('Raw message data:', data);
            }
        });

        socket.on("callSummary", (data) => {
            console.log('\n=== Received callSummary message ===');
            console.log('Data:', data);

            // whenever the UI sends a payload over via socketio, we will create a new celery task to process it
            const conversationid = [...socket.rooms][1] // see if we can get the room from the socket
            const parsed = JSON.parse(data)
            const payload = {
                type: "session_ended",
                parameters: {
                    text: parsed.text,
                    conversationid: conversationid
                },
                // get the room id              
            }
            console.log('Processing callSummary payload:', payload);
            // topic, payload (string)
            celeryClient
                .createTask("aan_extensions.SummaryAgent.tasks.process_transcript")
                .applyAsync([parsed.destination, JSON.stringify(payload)]);
        });
        
        // Handle disconnection
        socket.on('disconnect', (reason) => {
            console.log('\n=== Client Disconnected ===');
            console.log('Socket ID:', socket.id);
            console.log('Reason:', reason);
            console.log('================================\n');
        });

        socket.on("callIdentification", async (data, callback) => {
            console.log('\n=== Received callIdentification message ===');
            console.log('Data:', data);

            const conversationid = data.conversationid
            const buttonType = data.buttonType
            try {
                // 先读取Redis中的旧数据
                const idvData = await redisClient.get(conversationid + '_idv');
                // 解析现有数据
                const parsedData = JSON.parse(idvData);
                // 读取conversationid key的全部内容作为history_messages                
                if (idvData) {
                    let historyMessages = parsedData.history_messages;
                    if (idvData.history_messages === null) {
                        try {
                            const conversationData = await redisClient.get(conversationid);
                            if (conversationData) {
                                // 尝试解析为JSON，如果不是JSON则作为字符串处理
                                try {
                                    const parsedConversation = JSON.parse(conversationData);
                                    historyMessages = Array.isArray(parsedConversation) ? parsedConversation : [parsedConversation];
                                } catch (e) {
                                    // 如果不是JSON格式，直接作为字符串数组
                                    historyMessages = [conversationData];
                                }
                            }
                        } catch (error) {
                            console.error('Error reading conversation data for history_messages:', error);
                            historyMessages = [];
                        }
                    }
                    // 只更新identified字段和history_messages字段
                    if (buttonType === "failed") {
                        parsedData.identified = "failed";
                        parsedData.verified = "failed";
                    } else {
                        parsedData.identified = "identified";
                    }
                    parsedData.history_messages = historyMessages;

                    // =========================此处对接 Watsonx Orchestrator Service=========================
                    if (assistant) {
                        try {
                            const response = await assistant.message({
                                assistantId: '1234567890',
                                sessionId: '1234567890',
                                input: {
                                    text: 'Hello, how are you?'
                                }
                            });
                            
                            console.log('Watsonx Orchestrator Service response:', response);
                            if (response && response.output) {
                                console.log('Watsonx Orchestrator Service response:', response);
                                // 保存更新后的数据
                                await redisClient.set(conversationid + '_idv', JSON.stringify(parsedData));
                                console.log('Updated identified field in redis:', conversationid + '_idv', 'new value:', buttonType);
                            } else {
                                console.log('Watsonx Orchestrator Service response:', response);
                            }
                        } catch (error) {
                            console.error('Error calling Watson Assistant:', error);
                            // 即使 Watson 调用失败，也继续保存数据到 Redis
                            await redisClient.set(conversationid + '_idv', JSON.stringify(parsedData));
                            console.log('Updated identified field in redis:', conversationid + '_idv', 'new value:', buttonType);
                        }
                    } else {
                        console.log('Watson Assistant not initialized, skipping API call');
                        // 直接保存数据到 Redis
                        await redisClient.set(conversationid + '_idv', JSON.stringify(parsedData));
                        console.log('Updated identified field in redis:', conversationid + '_idv', 'new value:', buttonType);
                    }
                    // =========================此处对接 Watsonx Orchestrator Service=========================
                    
                } else {
                    // 如果数据不存在，创建新的数据结构
                    // await redisClient.set(conversationid + '_idv', JSON.stringify(
                    //     {
                    //         "conversationId": conversationid,
                    //         "identified": buttonType,
                    //         "verified": "unverified",
                    //         "message": null,
                    //         "history_messages": historyMessages,
                    //         "pre_intent": "identify"
                    //     }
                    // ));
                    
                    console.log(' IDV data not found in redis: Created new identified data in redis:', conversationid + '_idv');
                    // 返回失败消息
                    if (typeof callback === 'function') {
                        callback({
                            status: 'error',
                            message: `Failed to process callIdentification: IDV data not found in redis: Created new identified data in redis`,
                            conversationid: conversationid,
                            error: 'IDV data not found in redis: Created new identified data in redis'
                        });
                    }
                }
                
                console.log('Processing callIdentification to redis:', conversationid + '_identified');
                
                // 返回成功消息
                if (typeof callback === 'function') {
                    callback({
                        status: 'success',
                        message: `Successfully processed callIdentification for conversation ${conversationid}`,
                        conversationid: conversationid
                    });
                }
            } catch (error) {
                console.error('Error processing callIdentification:', error);
                
                // 返回失败消息
                if (typeof callback === 'function') {
                    callback({
                        status: 'error',
                        message: `Failed to process callIdentification: ${error.message}`,
                        conversationid: conversationid,
                        error: error.message
                    });
                }
            }
        });

        socket.on("callValidation", async (data, callback) => {
            console.log('\n=== Received callValidation message ===');
            console.log('Data:', data);

            const conversationid = data.conversationid
            const buttonType = data.buttonType
            try {
                // 先读取Redis中的旧数据
                const idvData = await redisClient.get(conversationid + '_idv');
                // 解析现有数据
                const parsedData = JSON.parse(idvData);
                // 读取conversationid key的全部内容作为history_messages                
                if (idvData) {
                    let idvMessages = parsedData.messages;
                    let historyMessages = parsedData.history_messages;
                    if (idvData.history_messages === null) {
                        try {
                            const conversationData = await redisClient.get(conversationid);
                            if (conversationData) {
                                // 尝试解析为JSON，如果不是JSON则作为字符串处理
                                try {
                                    const parsedConversation = JSON.parse(conversationData);
                                    historyMessages = Array.isArray(parsedConversation) ? parsedConversation : [parsedConversation];
                                } catch (e) {
                                    // 如果不是JSON格式，直接作为字符串数组
                                    historyMessages = [conversationData];
                                }
                            }
                        } catch (error) {
                            console.error('Error reading conversation data for history_messages:', error);
                            historyMessages = [];
                        }
                    }
                    // 只更新verified字段和history_messages字段
                    if (buttonType === "failed") {
                        parsedData.verified = "failed";
                    } else {
                        parsedData.verified = "verified";
                    }
                    parsedData.history_messages = historyMessages;
                    parsedData.messages = idvMessages;
                    // =========================此处对接 Watsonx Orchestrator Service=========================
                    if (assistant) {
                        try {
                            const response = await assistant.message({
                                assistantId: '1234567890',
                                sessionId: '1234567890',
                                input: {
                                    text: 'Hello, how are you?'
                                }
                            });
                            
                            console.log('Watsonx Orchestrator Service response:', response);
                            if (response && response.output) {
                                console.log('Watsonx Orchestrator Service response:', response);
                                // 保存更新后的数据
                                await redisClient.set(conversationid + '_idv', JSON.stringify(parsedData));
                                console.log('Updated verified field in redis:', conversationid + '_idv', 'new value:', buttonType);
                            } else {
                                console.log('Watsonx Orchestrator Service response:', response);
                            }
                        } catch (error) {
                            console.error('Error calling Watson Assistant:', error);
                            // 即使 Watson 调用失败，也继续保存数据到 Redis
                            await redisClient.set(conversationid + '_idv', JSON.stringify(parsedData));
                            console.log('Updated verified field in redis:', conversationid + '_idv', 'new value:', buttonType);
                        }
                    } else {
                        console.log('Watson Assistant not initialized, skipping API call');
                        // 直接保存数据到 Redis
                        await redisClient.set(conversationid + '_idv', JSON.stringify(parsedData));
                        console.log('Updated verified field in redis:', conversationid + '_idv', 'new value:', buttonType);
                    }
                    // =========================此处对接 Watsonx Orchestrator Service=========================
                    
                } else {
                    // 如果数据不存在，创建新的数据结构
                    // await redisClient.set(conversationid + '_idv', JSON.stringify({
                    //     "conversationId": conversationid,
                    //     "identified": "identified",
                    //     "verified": buttonType,
                    //     "message": null,
                    //     "history_messages": historyMessages,
                    //     "pre_intent": "verify"
                    // }));
                    
                    console.log(' IDV data not found in redis: Created new verified data in redis:', conversationid + '_idv');
                    // 返回失败消息
                    if (typeof callback === 'function') {
                        callback({
                            status: 'error',
                            message: `Failed to process callValidation: IDV data not found in redis: Created new verified data in redis`,
                            conversationid: conversationid,
                            error: 'IDV data not found in redis: Created new verified data in redis'
                        });
                    }
                }
                
                console.log('Processing callValidation to redis:', conversationid + '_idv');
                
                // 返回成功消息
                if (typeof callback === 'function') {
                    callback({
                        status: 'success',
                        message: `Successfully processed callValidation for conversation ${conversationid}`,
                        conversationid: conversationid
                    });
                }
            } catch (error) {
                console.error('Error processing callValidation:', error);
                
                // 返回失败消息
                if (typeof callback === 'function') {
                    callback({
                        status: 'error',
                        message: `Failed to process callValidation: ${error.message}`,
                        conversationid: conversationid,
                        error: error.message
                    });
                }
            }
        });
    });

    return io
}