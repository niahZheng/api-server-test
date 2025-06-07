const { io } = require('socket.io-client');

let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

function connect() {
    console.log(`Attempting to connect (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
    
    // 连接到 Socket.IO 服务器的 /celery 命名空间
    const socket = io('https://rx-api-server-ddfrdga2exavdcbb.canadacentral-01.azurewebsites.net/celery', {
    // const socket = io('http://localhost:8000/celery', {
        path: '/socket.io',
        transports: ['polling'],
        reconnection: false,
        timeout: 10000,
        debug: true,
        forceNew: true,
        rejectUnauthorized: false,
        extraHeaders: {
            "Access-Control-Allow-Origin": "*"
        }
    });

    // 连接成功事件
    socket.on('connect', () => {
        console.log('Connected to /celery namespace!');
        console.log('Socket ID:', socket.id);
        console.log('Transport:', socket.io.engine.transport.name);
        
        // 发送测试消息
        console.log('Sending test message...');
        socket.emit('celeryMessage', {
            agent_id: 'test_room',
            message: 'Test message from client'
        }, (response) => {
            console.log('Message sent successfully!');
            console.log('Server response:', response);
        });
    });

    // 连接错误事件
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error.message);
        console.error('Error details:', error);
        console.error('Transport state:', socket.io.engine.transport.name);
        
        // 检查是否是应用停止的错误
        if (error.message.includes('403') && error.description && error.description.includes('web app is stopped')) {
            console.error('The Azure App Service is stopped. Please start it in the Azure Portal.');
            process.exit(1);
        }
        
        // 重试逻辑
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`Retrying in ${RETRY_DELAY/1000} seconds...`);
            setTimeout(() => {
                socket.disconnect();
                connect();
            }, RETRY_DELAY);
        } else {
            console.error('Max retries reached. Giving up.');
            process.exit(1);
        }
    });

    // 断开连接事件
    socket.on('disconnect', (reason) => {
        console.log('Disconnected:', reason);
    });

    // 监听 celery 消息
    socket.on('celeryMessage', (data) => {
        console.log('Received celery message:', data);
    });

    // 监听所有事件
    socket.onAny((eventName, ...args) => {
        console.log(`Received event: ${eventName}`, args);
    });

    // 错误处理
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });

    // 保持进程运行
    process.on('SIGINT', () => {
        socket.disconnect();
        process.exit();
    });
}

// 开始连接
connect(); 