# RX API Server

A real-time Node.js API server with Socket.IO integration, Redis caching, and Celery task processing for agent assistance applications.

**Developer:** zhenglip@cn.ibm.com

## 🚀 Features

- **Real-time Communication**: Socket.IO for WebSocket connections
- **Redis Integration**: Caching and session management
- **Celery Task Processing**: Asynchronous task handling
- **OIDC Authentication**: JWT-based authentication support
- **PostgreSQL Adapter**: Socket.IO room persistence
- **Admin UI**: Socket.IO monitoring interface
- **Docker Support**: Containerized deployment
- **Azure App Service**: Cloud deployment ready

## 📋 Prerequisites

- Node.js 20.x or higher
- Redis server
- PostgreSQL database (optional, for Socket.IO persistence)
- Python environment (for Celery workers)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd api-server-test
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the root directory:
   ```env
   # Server Configuration
   PORT=8000
   NODE_ENV=development
   
   # Redis Configuration
   REDIS_PASSWORD=your_redis_password
   
   # Database Configuration (optional)
   SOCKETIO_DB_URI=postgresql://user:password@localhost:5432/database
   
   # OIDC Configuration (optional)
   OIDC_ISSUER=https://your-oidc-issuer.com
   OIDC_ISSUER_JWKS_URI=https://your-oidc-issuer.com/publickeys
   
   # Watson Assistant (optional)
   WATSONX_ORCHESTRATOR_API_KEY=your_watson_api_key
   
   # SSL Configuration
   FORCE_SSL=false
   ```

## 🏃‍♂️ Running the Application

### Development Mode
```bash
npm run develop
```

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:8000`

## 🐳 Docker Deployment

### Build the Docker Image
```bash
docker build -t rx-api-server .
```

### Run with Docker
```bash
docker run -p 8000:8000 --env-file .env rx-api-server
```

### Docker Compose (Recommended)
Create a `docker-compose.yml` file:
```yaml
version: '3.8'
services:
  api-server:
    build: .
    ports:
      - "8000:8000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    depends_on:
      - redis
      - postgres
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --requirepass ${REDIS_PASSWORD}
  
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: socketio
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Run with:
```bash
docker-compose up -d
```

## ☁️ Azure App Service Deployment

The project includes GitHub Actions workflow for automatic deployment to Azure App Service.

### Prerequisites
- Azure App Service instance
- Azure Redis Cache
- GitHub repository with secrets configured

### Deployment Steps
1. Configure Azure App Service publish profile in GitHub secrets
2. Push to `main` branch to trigger automatic deployment
3. Monitor deployment in GitHub Actions

## 📡 Socket.IO API

### Connection
```javascript
const socket = io('http://localhost:8000', {
  path: '/socket.io'
});
```

### Available Events

#### Join Room
```javascript
socket.emit('joinRoom', roomName, (response) => {
  console.log(response);
  // { status: 'ok', message: 'Successfully joined room', socketId: '...' }
});
```

#### Leave Room
```javascript
socket.emit('leaveRoom', roomName, (response) => {
  console.log(response);
  // { status: 'ok', message: 'Successfully left room' }
});
```

#### Web UI Message
```javascript
socket.emit('webUiMessage', JSON.stringify({
  text: 'User message',
  destination: 'agent'
}));
```

#### Call Identification
```javascript
socket.emit('callIdentification', {
  conversationid: 'conversation-123',
  buttonType: 'success' // or 'failed'
}, (response) => {
  console.log(response);
});
```

#### Call Validation
```javascript
socket.emit('callValidation', {
  conversationid: 'conversation-123',
  buttonType: 'success' // or 'failed'
}, (response) => {
  console.log(response);
});
```

#### Get Rooms
```javascript
socket.emit('getRooms', (response) => {
  console.log(response.rooms);
  // ['room1', 'room2', ...]
});
```

### Admin UI
Access Socket.IO Admin UI at: `http://localhost:8000/admin`

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8000` |
| `NODE_ENV` | Environment mode | `development` |
| `REDIS_PASSWORD` | Redis authentication password | - |
| `SOCKETIO_DB_URI` | PostgreSQL connection string | - |
| `OIDC_ISSUER` | OIDC issuer URL | - |
| `WATSONX_ORCHESTRATOR_API_KEY` | Watson Assistant API key | - |
| `FORCE_SSL` | Force HTTPS redirect | `false` |

### Redis Configuration
The application connects to Azure Redis Cache by default:
```
rediss://default:${REDIS_PASSWORD}@rx-redis.redis.cache.windows.net:6380/1
```

## 📁 Project Structure

```
├── index.js                 # Main application entry point
├── package.json            # Dependencies and scripts
├── Dockerfile              # Docker configuration
├── .github/workflows/      # GitHub Actions workflows
├── socketio/               # Socket.IO configuration
│   ├── configureSocketio.js # Socket.IO setup and event handlers
│   └── configurePool.js    # Database connection pool
├── celery/                 # Celery integration
│   └── celeryClient.js     # Celery client configuration
├── middlewares/            # Express middlewares
├── utils/                  # Utility functions
├── oidc/                   # OIDC authentication
├── public/                 # Static files
└── uploads/                # File upload directory
```

## 🔒 Security

- **CORS**: Configured for cross-origin requests
- **HPP Protection**: HTTP Parameter Pollution prevention
- **JWT Authentication**: Optional OIDC integration
- **Non-root User**: Docker runs as non-root user
- **SSL Support**: HTTPS redirection capability

## 📊 Monitoring

### Health Check
```bash
curl http://localhost:8000/health
```

### Logs
- Application logs are output to stdout/stderr
- Azure App Service logs available in Azure Portal
- Socket.IO Admin UI for real-time monitoring

## 🧪 Testing

### Manual Testing
1. Start the server
2. Connect via Socket.IO client
3. Test room joining/leaving
4. Verify message handling

### Integration Testing
```bash
# Test Socket.IO connection
node -e "
const io = require('socket.io-client');
const socket = io('http://localhost:8000');
socket.on('connect', () => {
  console.log('Connected successfully');
  socket.disconnect();
});
"
```

## 🚨 Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Verify Redis server is running
   - Check `REDIS_PASSWORD` environment variable

2. **Socket.IO Connection Issues**
   - Ensure correct path: `/socket.io`
   - Check CORS configuration

3. **Azure Deployment Issues**
   - Verify publish profile in GitHub secrets
   - Check Azure App Service logs

4. **Watson Assistant Errors**
   - Verify API key configuration
   - Check network connectivity

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

## 🔄 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates. 