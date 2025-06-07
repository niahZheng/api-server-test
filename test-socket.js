const { io } = require('socket.io-client');

// 连接到 Socket.IO 服务器的 /celery 命名空间
const socket = io('https://rx-celery-agent-emh9eqesbjhbbng5.canadacentral-01.azurewebsites.net/celery', {
    transports: ['websocket'],
    path: '/socket.io',
    reconnection: false,
    timeout: 10000,
    debug: true
});

// 连接成功事件
socket.on('connect', () => {
    console.log('Connected to server!');
    console.log('Socket ID:', socket.id);
    console.log('Transport:', socket.io.engine.transport.name);
    
    // 发送测试消息
    socket.emit('celeryMessage', {
        agent_id: 'test_room',
        message: 'Test message from client'
    });
});

// 连接错误事件
socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    console.error('Error details:', error);
    console.error('Transport state:', socket.io.engine.transport.name);
});

// 断开连接事件
socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
});

// 监听 celery 消息
socket.on('celeryMessage', (data) => {
    console.log('Received celery message:', data);
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