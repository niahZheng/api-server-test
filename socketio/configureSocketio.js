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
        }
    });

    // 配置 Socket.IO Admin UI
    instrument(io, {
        auth: false,  // 禁用认证
        mode: "development",
        namespaceName: "/celery",  // 监控 /celery 命名空间
        readonly: false,
        serverId: "api-server"
    });

    console.log('\n=== Socket.IO Admin UI ===');
    console.log('Admin UI is available at: http://localhost:8000/admin');
    console.log('Authentication is disabled');
    console.log('===========================\n');

    if (pool) {
        io.adapter(createAdapter(pool, {
            tableName: 'data.socket_io_attachments',
        }));
    }


    // Handle client connections
    io.on('connection', (socket) => {
        // 加入房间
        socket.on('joinRoom', (roomName, callback) => {
            try {
                console.log(`\n=== Joining Room in /celery namespace ===`);
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
                console.log('All rooms in server:', Array.from(io.sockets.adapter.rooms.keys()));
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

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log('\n=== Client Disconnected ===');
            console.log('Socket ID:', socket.id);
            console.log('===========================\n');
        });

        socket.onAny((eventName, ...args) => {
            // console.log(`\n=== Received Event ===`, eventName);
            // console.log('Event:');
            // console.log('Socket ID:', socket.id);
            // console.log('===========================\n');
        });
    });

    // 在 /celery 命名空间中处理所有房间相关的操作
    io.of("/celery").on("connection", (socket) => {

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
                console.log(`\n=== Leaving Room in /celery ===`);
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
            console.log('Socket ID:', socket.id);
            try {

                // 解析消息
                const messageData = JSON.parse(data.payloadString);
                const conversationid = messageData.conversationid;

                // 打印解析后的消息体
                console.log('\n =================== Message Body ===================');
                console.log('Conversation ID:', conversationid);
                console.log('Message Type:', messageData.type);
                if (messageData.parameters) {
                    console.log('Parameters:', JSON.stringify(messageData.parameters, null, 2));
                }
                console.log('====================================================\n');

                console.log(`Emitting message to room ${conversationid} on Socket ${socket.id}`);
                // Emits the message to the correct room "conversationid"
                io.to(conversationid).emit('celeryMessage', data);
            } catch (error) {
                console.error('Error parsing JSON:', error);
            }
        });

        socket.onAny((eventName, ...args) => {
        });

        // Handle disconnection
        socket.on('disconnect', (reason) => {
            console.log('\n=== /celery Client Disconnected ===');
            console.log('Socket ID:', socket.id);
            console.log('Reason:', reason);
            console.log('================================\n');
        });
    });

    return io
}
