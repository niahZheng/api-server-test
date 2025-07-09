const socketIO = require('socket.io')
const { createAdapter } = require("@socket.io/postgres-adapter")
const debug = require('debug')('configureSocketIo')
const { instrument } = require("@socket.io/admin-ui");
const redis = require('redis');
const fetch = require('node-fetch');

const celeryClient = require('../celery/celeryClient')

// 创建 Redis 客户端
const redisClient = redis.createClient({
    url: `${process.env.AAN_REDIS_URI}`
});

// 连接 Redis
redisClient.connect().catch(console.error);

// Watson Assistant configuration and token management
let waToken = null;
let assistantConfig = null;

async function initializeWatsonAssistant() {
    try {
        // Check if required environment variables are set
        if (!process.env.AAN_ASSISTANT_URL || 
            !process.env.AAN_ASSISTANT_USERNAME || 
            !process.env.AAN_ASSISTANT_PASSWORD ||
            !process.env.AAN_ASSISTANT_INSTANCE ||
            !process.env.AAN_ASSISTANT_DEPLOYMENT_ID ||
            !process.env.AAN_ASSISTANT_ID ||
            !process.env.AAN_ASSISTANT_API_VERSION) {
            throw new Error('Watson Assistant environment variables are not properly configured');
        }

        // Get authentication token
        const authUrl = `${process.env.AAN_ASSISTANT_URL}/icp4d-api/v1/authorize`;
        const authPayload = {
            username: process.env.AAN_ASSISTANT_USERNAME,
            password: process.env.AAN_ASSISTANT_PASSWORD
        };

        const authResponse = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(authPayload)
        });

        if (!authResponse.ok) {
            throw new Error(`Authentication failed: ${authResponse.status}`);
        }

        const authData = await authResponse.json();
        waToken = authData.token;
        
        // Set up assistant configuration
        assistantConfig = {
            url: `${process.env.AAN_ASSISTANT_URL}/assistant/${process.env.AAN_ASSISTANT_DEPLOYMENT_ID}`,
            instance: process.env.AAN_ASSISTANT_INSTANCE,
            id: process.env.AAN_ASSISTANT_ID,
            apiVersion: process.env.AAN_ASSISTANT_API_VERSION
        };

        console.log('Watson Assistant initialized successfully');
        return true;
    } catch (error) {
        console.error('Failed to initialize Watson Assistant:', error.message);
        return false;
    }
}

async function createWatsonSession() {
    if (!waToken || !assistantConfig) {
        throw new Error('Watson Assistant not initialized');
    }

    const sessionUrl = `${assistantConfig.url}/instances/${assistantConfig.instance}/api/v2/assistants/${assistantConfig.id}/sessions?version=${assistantConfig.apiVersion}`;
    
    const response = await fetch(sessionUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${waToken}`,
            'accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Session creation failed: ${response.status}`);
    }

    const body = await response.json();
    return body.session_id;
}

async function sendWatsonMessage(sessionId, messagePayload) {
    if (!waToken || !assistantConfig) {
        throw new Error('Watson Assistant not initialized');
    }

    const messageUrl = `${assistantConfig.url}/instances/${assistantConfig.instance}/api/v2/assistants/${assistantConfig.id}/sessions/${sessionId}/message?version=${assistantConfig.apiVersion}`;
    
    const response = await fetch(messageUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${waToken}`,
            'accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
    });

    if (!response.ok) {
        throw new Error(`Message sending failed: ${response.status}`);
    }

    const responseData = await response.json();
    
    // Extract response texts similar to nba.py
    const responseTexts = responseData.output?.generic
        ?.filter(item => item.response_type === 'text')
        ?.map(item => item.text) || [];

    const customResponse = {
        session_ID: responseData.context?.global?.session_id || 'unknown',
        intentType: responseData.context?.skills?.['actions skill']?.skill_variables?.intent || 'None',
        quickActions: responseTexts,
        text: responseData.context?.skills?.['actions skill']?.skill_variables?.query_ || '',
        conversation_ID: responseData.context?.skills?.['actions skill']?.skill_variables?.conversation_ID || 'None',
    };

    return customResponse;
}

// Initialize Watson Assistant on startup
initializeWatsonAssistant();

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
                    const sessionId = await createWatsonSession();
                    await redisClient.set(conversationid + '_idv', JSON.stringify({
                        "session_ID": sessionId,
                        "conversation_ID": conversationid,
                        "Identified": "unidentified",
                        "Verified": "unverified",
                        "QA_inProgress": "True",
                        "pre_intent": "",
                        "text": ""
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
                    // 只更新identified字段和history_messages字段
                    if (buttonType === "failed") {
                        parsedData.Identified = "failed";
                        parsedData.Verified = "failed";
                    } else {
                        parsedData.Identified = "identified";
                        parsedData.Verified = "unverified";
                    }
                    // =========================此处对接 Watsonx Orchestrator Service=========================
                    if (waToken) {
                        try {
                            message_payload = {
                                "input": {
                                    "text": parsedData.text,
                                    'options': {'return_context': True}
                                },        
                                "context" : {
                                    'skills': {
                                    'actions skill': {
                                            'skill_variables': {
                                                'session_ID': parsedData.session_ID,
                                                'Identified': parsedData.Identified,
                                                'Verified': parsedData.Verified,
                                                'pre_intent': parsedData.intentType,
                                                'QA_inProgress': "False",  // True代表qa正常使用，False表示正在验证
                                                "conversation_ID": conversationid
                                            }
                                        }
                                    }
                                }
                            }                               
                            const response = await sendWatsonMessage(parsedData.session_ID, message_payload);
                            
                            console.log('Watsonx Orchestrator Service response:', response);
                            if (response) {
                                // 保存更新后的数据
                                await redisClient.set(conversationid + '_idv', JSON.stringify(response));
                                console.log('Updated identified field in redis:', conversationid + '_idv');
                            } else {
                                console.log('Cannot get response from Watsonx Orchestrator Service with this payload: ', message_payload);
                                // 返回失败消息
                                if (typeof callback === 'function') {
                                    callback({
                                        status: 'error',
                                        message: `Failed to process callIdentification: Cannot get response from Watsonx Orchestrator Service with this payload: ${message_payload}`,
                                        conversationid: conversationid,
                                        error: 'Cannot get response from Watsonx Orchestrator Service with this payload: ' + message_payload
                                    });
                                }
                            }
                        } catch (error) {
                            console.error('Error calling Watson Assistant:', error);
                            // 返回失败消息
                            if (typeof callback === 'function') {
                                callback({
                                    status: 'error',
                                    message: `Failed to process callIdentification: Cannot get response from Watsonx Orchestrator Service with this payload: ${message_payload}`,
                                    conversationid: conversationid,
                                    error: 'Cannot get response from Watsonx Orchestrator Service with this payload: ' + message_payload
                                });
                            }
                        }
                    } else {
                        console.log('Watson Assistant not initialized, skipping API call');
                        // 返回失败消息
                        if (typeof callback === 'function') {
                            callback({
                                status: 'error',
                                message: `Failed to process callIdentification: Watson Assistant not initialized`,
                                conversationid: conversationid,
                                error: 'Watson Assistant not initialized'
                            });
                        }
                    }
                    // =========================此处对接 Watsonx Orchestrator Service=========================
                    
                } else {                    
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

            const conversationid = data.conversationid;
            const buttonType = data.buttonType;
            try {
                // Get existing data
                const idvData = await redisClient.get(conversationid + '_idv');
                if (idvData) {
                    const parsedData = JSON.parse(idvData);

                    // Update fields
                    if (buttonType === "failed") {
                        parsedData.Verified = "failed";
                    } else {
                        parsedData.Verified = "verified";
                    }

                    if (waToken) {
                        try {
                            const message_payload = {
                                "input": {
                                    "text": parsedData.text,
                                    'options': {'return_context': true}
                                },
                                "context": {
                                    'skills': {
                                        'actions skill': {
                                            'skill_variables': {
                                                'session_ID': parsedData.session_ID,
                                                'Identified': parsedData.Identified,
                                                'Verified': parsedData.Verified,
                                                'pre_intent': parsedData.intentType,
                                                'QA_inProgress': "False",
                                                "conversation_ID": conversationid
                                            }
                                        }
                                    }
                                }
                            };
                            const response = await sendWatsonMessage(parsedData.session_ID, message_payload);
                            console.log('Watsonx Orchestrator Service response:', response);
                            if (response) {
                                await redisClient.set(conversationid + '_idv', JSON.stringify(response));
                                console.log('Updated verified field in redis:', conversationid + '_idv');
                            } else {
                                console.log('Cannot get response from Watsonx Orchestrator Service with this payload: ', message_payload);
                                if (typeof callback === 'function') {
                                    callback({
                                        status: 'error',
                                        message: `Failed to process callValidation: Cannot get response from Watsonx Orchestrator Service with this payload: ${JSON.stringify(message_payload)}`,
                                        conversationid: conversationid,
                                        error: 'Cannot get response from Watsonx Orchestrator Service with this payload: ' + JSON.stringify(message_payload)
                                    });
                                }
                            }
                        } catch (error) {
                            console.error('Error calling Watson Assistant:', error);
                            if (typeof callback === 'function') {
                                callback({
                                    status: 'error',
                                    message: `Failed to process callValidation: Cannot get response from Watsonx Orchestrator Service with this payload: ${JSON.stringify(message_payload)}`,
                                    conversationid: conversationid,
                                    error: 'Cannot get response from Watsonx Orchestrator Service with this payload: ' + JSON.stringify(message_payload)
                                });
                            }
                        }
                    } else {
                        console.log('Watson Assistant not initialized, skipping API call');
                        if (typeof callback === 'function') {
                            callback({
                                status: 'error',
                                message: `Failed to process callValidation: Watson Assistant not initialized`,
                                conversationid: conversationid,
                                error: 'Watson Assistant not initialized'
                            });
                        }
                    }
                } else {
                    console.log('IDV data not found in redis: Created new verified data in redis:', conversationid + '_idv');
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

                // Success callback
                if (typeof callback === 'function') {
                    callback({
                        status: 'success',
                        message: `Successfully processed callValidation for conversation ${conversationid}`,
                        conversationid: conversationid
                    });
                }
            } catch (error) {
                console.error('Error processing callValidation:', error);
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