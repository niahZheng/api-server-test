const celery = require('celery-node');

const rabbitUrl = process.env.AAN_AMQP_URI || 'amqp://admin:adminpass@localhost:5672';
const redisUrl = process.env.AAN_REDIS_URI || 'redis://localhost:6379/1'

const client = celery.createClient(
    rabbitUrl, redisUrl
);

module.exports = client