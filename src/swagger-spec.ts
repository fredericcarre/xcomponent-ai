/**
 * OpenAPI/Swagger specification for xcomponent-ai API
 */

import { Component } from './types';

export function generateSwaggerSpec(component: Component, port: number) {
  return {
    openapi: '3.0.0',
    info: {
      title: 'xcomponent-ai REST API',
      version: '0.2.2',
      description: `REST API for ${component.name} FSM runtime. 
      
Manage state machine instances, send events, and monitor execution in real-time.`,
      contact: {
        name: 'xcomponent-ai',
        url: 'https://github.com/fredericcarre/mayele-ai'
      }
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: 'Local development server'
      }
    ],
    tags: [
      {
        name: 'Instances',
        description: 'Create and manage FSM instances'
      },
      {
        name: 'Events',
        description: 'Send events to instances'
      }
    ],
    paths: {
      '/api/instances': {
        get: {
          tags: ['Instances'],
          summary: 'List all instances',
          description: 'Get a list of all FSM instances across all state machines',
          responses: {
            '200': {
              description: 'List of instances',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      instances: {
                        type: 'array',
                        items: {
                          $ref: '#/components/schemas/Instance'
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        post: {
          tags: ['Instances'],
          summary: 'Create new instance',
          description: 'Create a new FSM instance for a specified state machine',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['machineName'],
                  properties: {
                    machineName: {
                      type: 'string',
                      description: 'Name of the state machine',
                      example: component.stateMachines[0]?.name || 'OrderEntry'
                    },
                    context: {
                      type: 'object',
                      description: 'Initial context for the instance',
                      example: {
                        orderId: 'ORD-001',
                        amount: 1000
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Instance created successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      instanceId: {
                        type: 'string',
                        description: 'Unique instance identifier'
                      }
                    }
                  }
                }
              }
            },
            '400': {
              description: 'Invalid request',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/api/instances/{instanceId}': {
        get: {
          tags: ['Instances'],
          summary: 'Get instance details',
          description: 'Retrieve details for a specific instance',
          parameters: [
            {
              name: 'instanceId',
              in: 'path',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Instance ID'
            }
          ],
          responses: {
            '200': {
              description: 'Instance details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      instance: {
                        $ref: '#/components/schemas/Instance'
                      }
                    }
                  }
                }
              }
            },
            '404': {
              description: 'Instance not found',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/api/instances/{instanceId}/events': {
        post: {
          tags: ['Events'],
          summary: 'Send event to instance',
          description: 'Send an event to trigger a state transition',
          parameters: [
            {
              name: 'instanceId',
              in: 'path',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Instance ID'
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['type'],
                  properties: {
                    type: {
                      type: 'string',
                      description: 'Event type',
                      example: 'VALIDATE'
                    },
                    payload: {
                      type: 'object',
                      description: 'Event payload',
                      example: {}
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Event sent successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: {
                        type: 'boolean'
                      }
                    }
                  }
                }
              }
            },
            '400': {
              description: 'Invalid event or transition not allowed',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Instance: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique instance identifier'
            },
            machineName: {
              type: 'string',
              description: 'State machine name'
            },
            currentState: {
              type: 'string',
              description: 'Current state'
            },
            status: {
              type: 'string',
              enum: ['active', 'final', 'error'],
              description: 'Instance status'
            },
            context: {
              type: 'object',
              description: 'Instance context data'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            }
          }
        }
      }
    }
  };
}
