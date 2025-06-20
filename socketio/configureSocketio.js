const socketIO = require('socket.io')
const { createAdapter } = require("@socket.io/postgres-adapter")
const debug = require('debug')('configureSocketIo')
const { instrument } = require("@socket.io/admin-ui");

const celeryClient = require('../celery/celeryClient')

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
        socket.on('joinRoom', (roomName, callback) => {
            try {
                console.log(`\n=== Joining Room ===`);
                console.log(`Socket ${socket.id} attempting to join room ${roomName}`);

                // 确保房间名称不包含引号
                const cleanRoomName = roomName.replace(/"/g, '');

                // 检查房间是否存在
                const room = io.sockets.adapter.rooms.get(cleanRoomName);
                if (!room) {
                    console.log(`Room ${cleanRoomName} does not exist, creating it...`);
                } else {
                    console.log(`Room ${cleanRoomName} exists with ${room.size} sockets`);
                }

                // 加入房间
                socket.join(cleanRoomName);

                // 获取当前房间列表，排除 socket ID 房间
                const currentRooms = Array.from(socket.rooms).filter(room => room !== socket.id);

                console.log(`Socket ${socket.id} joined room ${cleanRoomName}`);
                console.log('Current rooms after join:', currentRooms);
                console.log('All rooms:', Array.from(io.sockets.adapter.rooms.keys()));
                console.log('===============================\n');

                if (typeof callback === 'function') {
                    callback({
                        status: 'ok',
                        message: `Successfully joined room ${cleanRoomName}`,
                        rooms: currentRooms,
                        allRooms: Array.from(io.sockets.adapter.rooms.keys()),
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

                // 检查必要的字段
                if (!payload.conversationid) {
                    console.error('Missing conversationid in payload:', payload);
                    return;
                }

                console.log('Message data:', {
                    conversationid: payload.conversationid,
                    type: payload.type,
                    parameters: payload.parameters,
                    destinationName: messageData.destinationName
                });

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
            console.log('Socket ID:', socket.id);
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

                // 检查必要的字段
                if (!payload.conversationid) {
                    console.error('Missing conversationid in payload:', payload);
                    return;
                }

                console.log('Message data:', {
                    conversationid: payload.conversationid,
                    type: payload.type,
                    parameters: payload.parameters,
                    destinationName: messageData.destinationName
                });

                console.log(`Emitting message to room ${payload.conversationid} on Socket ${socket.id}`);
                // Emits the message to the correct room "conversationid"
                io.to(payload.conversationid).emit('celeryMessage', messageData);
            } catch (error) {
                console.error('Error processing celeryMessage:', error);
                console.error('Raw message data:', data);
            }
        });
        
        // Handle disconnection
        socket.on('disconnect', (reason) => {
            console.log('\n=== Client Disconnected ===');
            console.log('Socket ID:', socket.id);
            console.log('Reason:', reason);
            console.log('================================\n');
        });
    });

    return io
}