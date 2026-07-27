import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HevyClient } from '../hevy/client.js';
import { handleToolError } from '../utils/errors.js';
import { formatRoutine, formatRoutineList } from '../utils/formatters.js';
import {
  CreateRoutineInputSchema,
  UpdateRoutineInputSchema,
  LimitedPaginationParamsSchema,
  safeValidateInput,
} from '../utils/validators.js';

// Export routine tool definitions
export function getRoutineTools() {
  return [
    {
      name: 'get-routines',
      description:
        'Get a paginated list of saved workout routines/templates. Returns routine summaries including title, ID, and exercise count.',
      inputSchema: {
        type: 'object',
        properties: {
          page: {
            type: 'number',
            description: 'Page number for pagination (default: 1)',
            default: 1,
            minimum: 1,
          },
          pageSize: {
            type: 'number',
            description: 'Number of routines per page (default: 10, max: 10)',
            default: 10,
            minimum: 1,
            maximum: 10,
          },
        },
      },
    },
    {
      name: 'get-routine',
      description:
        'Get detailed information about a specific routine by ID. Returns full routine details including all exercises and planned sets.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique routine ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'create-routine',
      description:
        'Create a new workout routine template. Routines can be used to quickly start workouts with predefined exercises and sets.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Routine title (e.g., "Push Day", "Full Body Workout")',
          },
          folder_id: {
            type: 'string',
            description: 'Optional folder ID to organize routine',
          },
          exercises: {
            type: 'array',
            description: 'Array of exercises in this routine',
            items: {
              type: 'object',
              properties: {
                exercise_template_id: {
                  type: 'string',
                  description: 'ID of the exercise template',
                },
                superset_id: {
                  oneOf: [{ type: 'string' }, { type: 'number' }],
                  description: 'Optional superset ID to group exercises',
                },
                notes: {
                  type: 'string',
                  description: 'Optional notes for this exercise',
                },
                sets: {
                  type: 'array',
                  description: 'Array of planned sets',
                  items: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['normal', 'warmup', 'dropset', 'failure'],
                        description: 'Type of set',
                      },
                      weight_kg: {
                        type: 'number',
                        description: 'Planned weight in kilograms',
                      },
                      reps: {
                        type: 'number',
                        description: 'Planned number of repetitions',
                      },
                      distance_meters: {
                        type: 'number',
                        description: 'Planned distance in meters (for cardio)',
                      },
                      duration_seconds: {
                        type: 'number',
                        description: 'Planned duration in seconds',
                      },
                      rpe: {
                        type: 'number',
                        description: 'Planned Rate of Perceived Exertion (1-10)',
                      },
                    },
                    required: ['type'],
                  },
                },
                rest_seconds: {
                  type: 'number',
                  description: 'Rest time after this exercise in seconds',
                },
              },
              required: ['exercise_template_id', 'sets'],
            },
          },
        },
        required: ['title', 'exercises'],
      },
    },
    {
      name: 'update-routine',
      description:
        'Update an existing routine. You can update title or exercises. Only provide fields you want to change.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique routine ID to update',
          },
          title: {
            type: 'string',
            description: 'New routine title',
          },
          exercises: {
            type: 'array',
            description: 'New exercises array (replaces all existing exercises)',
            items: {
              type: 'object',
              properties: {
                exercise_template_id: {
                  type: 'string',
                  description: 'ID of the exercise template',
                },
                superset_id: {
                  oneOf: [{ type: 'string' }, { type: 'number' }],
                  description: 'Optional superset ID to group exercises',
                },
                notes: {
                  type: 'string',
                  description: 'Optional notes for this exercise',
                },
                sets: {
                  type: 'array',
                  description: 'Array of planned sets',
                  items: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['normal', 'warmup', 'dropset', 'failure'],
                        description: 'Type of set',
                      },
                      weight_kg: {
                        type: 'number',
                        description: 'Planned weight in kilograms',
                      },
                      reps: {
                        type: 'number',
                        description: 'Planned number of repetitions',
                      },
                      distance_meters: {
                        type: 'number',
                        description: 'Planned distance in meters (for cardio)',
                      },
                      duration_seconds: {
                        type: 'number',
                        description: 'Planned duration in seconds',
                      },
                      rpe: {
                        type: 'number',
                        description: 'Planned Rate of Perceived Exertion (1-10)',
                      },
                    },
                    required: ['type'],
                  },
                },
                rest_seconds: {
                  type: 'number',
                  description: 'Rest time after this exercise in seconds',
                },
              },
              required: ['exercise_template_id', 'sets'],
            },
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete-routine',
      description: 'Delete a routine by ID. This action cannot be undone.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique routine ID to delete',
          },
        },
        required: ['id'],
      },
    },
  ];
}

// Handle routine tool calls
export async function handleRoutineToolCall(request: any, client: HevyClient) {
  try {
    switch (request.params.name) {
        case 'get-routines': {
          const validation = safeValidateInput(
            LimitedPaginationParamsSchema,
            request.params.arguments || {}
          );

          if (!validation.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Validation error: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
          }

          const routines = await client.getRoutines(validation.data);
          return {
            content: [
              {
                type: 'text',
                text: formatRoutineList(routines),
              },
            ],
          };
        }

        case 'get-routine': {
          const { id } = request.params.arguments as { id: string };
          if (!id) {
            return {
              content: [{ type: 'text', text: 'Error: routine ID is required' }],
              isError: true,
            };
          }

          const routine = await client.getRoutine(id);
          return {
            content: [
              {
                type: 'text',
                text: formatRoutine(routine),
              },
            ],
          };
        }

        case 'create-routine': {
          const validation = safeValidateInput(
            CreateRoutineInputSchema,
            request.params.arguments || {}
          );

          if (!validation.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Validation error: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
          }

          const routine = await client.createRoutine(validation.data);
          return {
            content: [
              {
                type: 'text',
                text: `✅ Routine created successfully!\n\n${formatRoutine(routine)}`,
              },
            ],
          };
        }

        case 'update-routine': {
          const { id, ...updateData } = request.params.arguments as any;
          if (!id) {
            return {
              content: [{ type: 'text', text: 'Error: routine ID is required' }],
              isError: true,
            };
          }

          const validation = safeValidateInput(UpdateRoutineInputSchema, updateData);

          if (!validation.success) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Validation error: ${validation.error.message}`,
                },
              ],
              isError: true,
            };
          }

          const routine = await client.updateRoutine(id, validation.data);
          return {
            content: [
              {
                type: 'text',
                text: `✅ Routine updated successfully!\n\n${formatRoutine(routine)}`,
              },
            ],
          };
        }

        case 'delete-routine': {
          const { id } = request.params.arguments as { id: string };
          if (!id) {
            return {
              content: [{ type: 'text', text: 'Error: routine ID is required' }],
              isError: true,
            };
          }

          await client.deleteRoutine(id);
          return {
            content: [
              {
                type: 'text',
                text: `✅ Routine deleted successfully! (ID: ${id})`,
              },
            ],
          };
        }

        default:
          return null; // Tool not handled by this module
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: handleToolError(error),
          },
        ],
        isError: true,
      };
    }
}
