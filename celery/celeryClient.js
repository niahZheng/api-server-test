const celery = require('celery-node');

const rabbitUrl = process.env.AAN_AMQP_URI || 'amqp://rxadmin:rxadmin321@20.39.130.141:5672';
const redisUrl = `rediss://default:${process.env.REDIS_PASSWORD}@rx-redis.redis.cache.windows.net:6380/1?ssl_cert_reqs=none`;

const client = celery.createClient(
    rabbitUrl, redisUrl
);

module.exports = client