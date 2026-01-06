/**
 * Swagger/OpenAPI Configuration
 * Generates OpenAPI 3.0 specification for ApogeeHnP API
 */

const swaggerJsdoc = require('swagger-jsdoc');
const schemas = require('./swagger/schemas');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ApogeeHnP API',
      version: '1.0.0',
      description: 'Health and Performance Tracking API - Comprehensive fitness tracking, workout planning, and AI-powered coaching.',
      contact: {
        name: 'Apogee Team',
        email: 'support@apogeehnp.com'
      },
      license: {
        name: 'Proprietary',
        url: 'https://apogeehnp.com/terms'
      }
    },
    servers: [
      {
        url: '/api',
        description: 'API Base Path'
      },
      {
        url: 'http://localhost:3000/api',
        description: 'Local Development Server'
      },
      {
        url: 'https://apogeehnp.azurewebsites.net/api',
        description: 'Production Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token'
        }
      },
      schemas: schemas,
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Invalid or expired token',
                errorCode: 'TOKEN_INVALID'
              }
            }
          }
        },
        NotFoundError: {
          description: 'The requested resource was not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Resource not found'
              }
            }
          }
        },
        ValidationError: {
          description: 'Invalid input data',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Validation failed',
                errorCode: 'VALIDATION_ERROR'
              }
            }
          }
        },
        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Internal server error'
              }
            }
          }
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication - signup, signin, token refresh, logout'
      },
      {
        name: 'OTP',
        description: 'One-time password operations for phone and email verification'
      },
      {
        name: 'MFA',
        description: 'Multi-factor authentication setup and verification'
      },
      {
        name: 'Biometric',
        description: 'Biometric authentication (Face ID, Touch ID)'
      },
      {
        name: 'Password',
        description: 'Password reset and recovery'
      },
      {
        name: 'User',
        description: 'User profile management'
      },
      {
        name: 'Dashboard',
        description: 'Dashboard analytics and weekly summaries'
      },
      {
        name: 'Daily Logs',
        description: 'Daily health metrics tracking (sleep, steps, heart rate, etc.)'
      },
      {
        name: 'Exercises',
        description: 'Exercise database and exercise instance tracking'
      },
      {
        name: 'Workouts',
        description: 'Workout routines and scheduling'
      },
      {
        name: 'Training Cycles',
        description: 'Mesocycles and microcycles for periodized training'
      },
      {
        name: 'Subscriptions',
        description: 'Payment and subscription management via Stripe'
      },
      {
        name: 'Chatbot',
        description: 'AI fitness assistant for workout generation and coaching'
      },
      {
        name: 'Workout Plans',
        description: 'AI-generated workout plan management'
      },
      {
        name: 'Usage',
        description: 'API usage tracking and limits'
      },
      {
        name: 'Webhooks',
        description: 'External webhook handlers (Stripe)'
      },
      {
        name: "Config",
        description: "Runtime configuration endpoints for mobile/web clients",
      }
    ]
  },
  apis: ['./routes/*.js']
};

module.exports = swaggerJsdoc(options);

