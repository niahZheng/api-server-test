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
        // cors: {
        //   origin: ["http://localhost:8000", "http://localhost:3003"], // Allow multiple origins
        // }
    });
    if (authenticateRequests) {
        debug('IO Engine will authenticateRequests')
        io.engine.use(authenticateRequests);
    }
    if (pool) {
        io.adapter(createAdapter(pool, {
            tableName: 'data.socket_io_attachments',
        }));
    }


    // Handle client connections
    io.on('connection', (socket) => {
        debug('A client connected');

        // Join a room based on client characteristics
        // this is typically emitted from the agent web UI requesting to join a room with its agent ID
        socket.on('joinRoom', (roomName) => {
            socket.join(roomName);
            debug(`Socket ${socket.id} joined room ${roomName}`);
        });

        // Handle custom events from web UI
        // Like next best action clicks
        socket.on('webUiMessage', (data) => {
            // Do something with the event data
            debug("web ui message received")
            // whenever the UI sends a payload over via socketio, we will create a new celery task to process it
            // the alternative is to leave a long running socketio connection between a worker and the web page (like in demo code)
            // but that is going to be a problem if we are scaling up
            // taking a small latency hit here might be worth it
            const agent_id = [...socket.rooms][1] // see if we can get the room from the socket
            const parsed = JSON.parse(data)
            const payload = {
                type: "manual_completion",
                parameters: {
                    text: parsed.text
                },
                agent_id:  agent_id// get the room id
            }
            console.log(payload)
            // topic, payload (string)
            celeryClient
                .createTask("aan_extensions.NextBestActionAgent.tasks.process_transcript")
                .applyAsync([parsed.destination, JSON.stringify(payload)]);
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            debug('A client disconnected');
        });
        socket.onAny((eventName, ...args) => {
            debug(`received ${eventName} in /celery`)
        });

    });
    io.of("/celery").on("connection", (socket) => {
        debug('A /celery client connected');
        socket.conn.once("upgrade", () => {
            // called when the transport is upgraded (i.e. from HTTP long-polling to WebSocket)
            debug("upgraded transport", socket.conn.transport.name); // prints "websocket"
        });

        // celeryMessage is emitted from python celery workers who complete a task
        // the data is routed to a specific agent's room
        socket.on("celeryMessage", (data) => {
            debug('received a message on /celery');
            try {
                // seems like data is already an object, no need to parse
                //const jsonData = JSON.parse(data);
                const agent_id = data.agent_id
                debug(`Emitting message to room ${agent_id} on Socket ${socket.id}`);
                // Emits the message to the correct room "agent_id"
                io.to(agent_id).emit('celeryMessage', data);
            } catch (error) {
                // Handle parsing error
                console.error('Error parsing JSON:', error);
                // io.emit('celeryMessage', data)
            }

        });
        socket.onAny((eventName, ...args) => {
            debug(`received ${eventName} in /celery`)
        });
    });

    instrument(io, {
        auth: false,
        mode: "development",
    });
    return io
}
