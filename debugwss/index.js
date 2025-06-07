const nconf = require('nconf')
const config = nconf.env().get()
const { Emitter } = require("@socket.io/postgres-emitter");
const { Pool } = require("pg");

console.log(config.SOCKETIO_DB_URI)

const pool = new Pool({
    connectionString: config.SOCKETIO_DB_URI,
    max: 1
});

const io = new Emitter(pool);
setInterval(() => {
    io.emit("ping", new Date());
  }, 1000);