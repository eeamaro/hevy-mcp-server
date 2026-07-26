import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HevyClient } from '../hevy/client.js';
import { handleToolError } from '../utils/errors.js';
import { formatExerciseTemplate, formatExerciseTemplateList } from '../utils/formatters.js';
import {
  PaginationParamsSchema,
  ExerciseProgressParamsSchema,
  safeValidateInput,
} from '../utils/validators.js';

// Export exercise tool definitions
export function getExerciseTools() {
  return [
    {
      name: 'get-exercise-templates',
      description:
        'Browse available exercise templates including both standard and custom exercises. Use this to find exercise IDs for creating workouts and routines.',
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
            description: 'Number of exercises per page (default: 50, max: 100)',
            default: 50,
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: 'get-exercise-template',
      description:
        'Get detailed information about a specific exercise template by ID. Returns exercise name, muscle groups, equipment, and movement pattern.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The unique exercise template ID',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'get-exercise-progress',
      description:
        'Track progress for a specific exercise over time. Returns historical data showing sets, weights, and reps for each workout.',
      inputSchema: {
        type: 'object',
        properties: {
          exercise_template_id: {
            type: 'string',
            description: 'The exercise template ID to track',
          },
          start_date: {
            type: 'string',
            description: 'ISO 8601 date string (YYYY-MM-DD) for start of date range',
          },
          end_date: {
            type: 'string',
            description: 'ISO 8601 date string (YYYY-MM-DD) for end of date range',
          },
          limit: {
            type: 'number',
            description: 'Max number of progress entries to return (default: 50, max: 100)',
            default: 50,
          },
        },
        required: ['exercise_template_id'],
      },
    },
    {
      name: 'get-exercise-stats',
      description:
        'Get personal records and statistics for a specific exercise. Returns PRs, estimated 1RM, total volume, and total reps.',
      inputSchema: {
        type: 'object',
        properties: {
          exercise_template_id: {
            type: 'string',
            description: 'The exercise template ID to get stats for',
          },
        },
        required: ['exercise_template_id'],
      },
    },
  ];
}

// Handle exercise tool calls
export async function handleExerciseToolCall(request: any, client: HevyClient) {
  try {
    switch (request.params.name) {
        case 'get-exercise-templates': {
          const validation = safeValidateInput(
            PaginationParamsSchema,
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

          const exercises = await client.getExerciseTemplates(validation.data);
          return {
            content: [
              {
                type: 'text',
                text: formatExerciseTemplateList(exercises),
              },
            ],
          };
        }

        case 'get-exercise-template': {
          const { id } = request.params.arguments as { id: string };
          if (!id) {
            return {
              content: [{ type: 'text', text: 'Error: exercise template ID is required' }],
              isError: true,
            };
          }

          const exercise = await client.getExerciseTemplate(id);
          return {
            content: [
              {
                type: 'text',
                text: formatExerciseTemplate(exercise),
              },
            ],
          };
        }

        case 'get-exercise-progress': {
          const validation = safeValidateInput(
            ExerciseProgressParamsSchema,
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

          const progress = await client.getExerciseProgress(validation.data);

          if (progress.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No progress data found for this exercise in the specified date range.',
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: `Progress data for exercise:\n\n${JSON.stringify(progress, null, 2)}`,
              },
            ],
          };
        }

        case 'get-exercise-stats': {
          const { exercise_template_id } = request.params.arguments as {
            exercise_template_id: string;
          };
          if (!exercise_template_id) {
            return {
              content: [{ type: 'text', text: 'Error: exercise_template_id is required' }],
              isError: true,
            };
          }

          const stats = await client.getExerciseStats(exercise_template_id);

          const lines: string[] = [];
          lines.push(`# Exercise Statistics`);
          lines.push(`Exercise ID: ${stats.exercise_template_id}`);
          lines.push('');

          if (stats.one_rep_max_kg) {
            lines.push(`**Estimated 1RM:** ${stats.one_rep_max_kg} kg`);
          }
          if (stats.total_volume_kg) {
            lines.push(`**Total Volume:** ${stats.total_volume_kg} kg`);
          }
          if (stats.total_reps) {
            lines.push(`**Total Reps:** ${stats.total_reps}`);
          }

          if (stats.personal_records && stats.personal_records.length > 0) {
            lines.push('');
            lines.push('## Personal Records');
            stats.personal_records.forEach((pr) => {
              lines.push(
                `- **${pr.type}**: ${pr.value} ${pr.unit} (${new Date(pr.date).toLocaleDateString()})`
              );
            });
          }

          return {
            content: [
              {
                type: 'text',
                text: lines.join('\n'),
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
