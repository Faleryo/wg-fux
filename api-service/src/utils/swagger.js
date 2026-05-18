const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WG-FUX API ',
      version: '3.1.0',
      description: 'API de gestion WireGuard Next-Gen ( Standard)',
    },
    servers: [
      {
        url: '/api',
        description: 'Production API',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./src/routes/*.js'], // files containing annotations as above
};

const specs = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  specs,
};
