import {
  HevyConfig,
  Workout,
  CreateWorkoutInput,
  UpdateWorkoutInput,
  WorkoutCountResponse,
  WorkoutEvent,
  Routine,
  CreateRoutineInput,
  UpdateRoutineInput,
  ExerciseTemplate,
  ExerciseProgress,
  ExerciseStats,
  ExerciseProgressParams,
  RoutineFolder,
  CreateFolderInput,
  WebhookSubscription,
  CreateWebhookInput,
  PaginationParams,
  WorkoutQueryParams,
} from './types.js';

export class HevyClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: HevyConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.hevyapp.com';
  }

  /**
   * Clean payload by removing only undefined values
   * Keeps null values as they are semantically meaningful to the API
   * (e.g., folder_id: null means "no folder")
   */
  private cleanPayload<T extends Record<string, any>>(obj: T): Partial<T> {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Create abort controller for timeout (60 seconds for API requests)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        let errorMessage = response.statusText;
        try {
          const errorBody = await response.text();
          // Try to parse as JSON first
          try {
            const errorJson = JSON.parse(errorBody);
            // Extract error message from common API error formats
            errorMessage = errorJson.error?.message ||
                          errorJson.message ||
                          errorJson.error ||
                          JSON.stringify(errorJson);
          } catch {
            // If not JSON, use the text as is
            errorMessage = errorBody || errorMessage;
          }
        } catch {
          // If we can't read the body, just use statusText
        }

        throw new Error(
          `Hevy API error (${response.status}): ${errorMessage}`
        );
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Hevy API request timed out');
        }
        throw error;
      }
      throw new Error(`Hevy API request failed: ${String(error)}`);
    }
  }

  // ===== Workout Methods =====

  async getWorkouts(params: WorkoutQueryParams = {}): Promise<Workout[]> {
    const { page = 1, pageSize = 10, startDate, endDate } = params;

    const queryParams = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });

    if (startDate) {
      queryParams.append('startDate', startDate);
    }
    if (endDate) {
      queryParams.append('endDate', endDate);
    }

    const endpoint = `/v1/workouts?${queryParams.toString()}`;
    const response = await this.request<{ workouts: Workout[] }>(endpoint);
    return response.workouts || [];
  }

  async getWorkout(id: string): Promise<Workout> {
    return this.request<Workout>(`/v1/workouts/${encodeURIComponent(id)}`);
  }

  async createWorkout(data: CreateWorkoutInput): Promise<Workout> {
    const response = await this.request<{ workout: Workout[] }>('/v1/workouts', {
      method: 'POST',
      body: JSON.stringify({ workout: this.cleanPayload(data) }),
    });
    // API returns { workout: [{ ... }] }, extract first element
    return response.workout[0];
  }

  async updateWorkout(id: string, data: UpdateWorkoutInput): Promise<Workout> {
    const response = await this.request<{ workout: Workout[] }>(`/v1/workouts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ workout: this.cleanPayload(data) }),
    });
    // API returns { workout: [{ ... }] }, extract first element
    return response.workout[0];
  }

  async deleteWorkout(id: string): Promise<void> {
    await this.request(`/v1/workouts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async getWorkoutCount(): Promise<WorkoutCountResponse> {
    return this.request<WorkoutCountResponse>('/v1/workouts/count');
  }

  async getWorkoutEvents(sinceDate: string): Promise<WorkoutEvent[]> {
    const queryParams = new URLSearchParams({ since: sinceDate });
    const response = await this.request<{ events: WorkoutEvent[] }>(
      `/v1/workouts/events?${queryParams.toString()}`
    );
    return response.events || [];
  }

  // ===== Routine Methods =====

  async getRoutines(params: PaginationParams = {}): Promise<Routine[]> {
    const { page = 1, pageSize = 10 } = params;
    const queryParams = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    const response = await this.request<{ routines: Routine[] }>(
      `/v1/routines?${queryParams.toString()}`
    );
    return response.routines || [];
  }

  async getRoutine(id: string): Promise<Routine> {
    const response = await this.request<{ routine: Routine }>(
      `/v1/routines/${encodeURIComponent(id)}`
    );
    return response.routine;
  }

  async createRoutine(data: CreateRoutineInput): Promise<Routine> {
    const response = await this.request<{ routine: Routine[] }>('/v1/routines', {
      method: 'POST',
      body: JSON.stringify({ routine: this.cleanPayload(data) }),
    });
    // API returns { routine: [{ ... }] }, extract first element
    return response.routine[0];
  }

  async updateRoutine(id: string, data: UpdateRoutineInput): Promise<Routine> {
    const { folder_id: _folderId, ...allowedData } = data as UpdateRoutineInput & {
      folder_id?: string | null;
    };

    const response = await this.request<{ routine: Routine[] }>(`/v1/routines/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ routine: this.cleanPayload(allowedData) }),
    });
    // API returns { routine: [{ ... }] }, extract first element
    return response.routine[0];
  }

  async deleteRoutine(id: string): Promise<void> {
    await this.request(`/v1/routines/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ===== Exercise Methods =====

  async getExerciseTemplates(params: PaginationParams = {}): Promise<ExerciseTemplate[]> {
    const { page = 1, pageSize = 50 } = params;
    const queryParams = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    const response = await this.request<{ exercise_templates: ExerciseTemplate[] }>(
      `/v1/exercise_templates?${queryParams.toString()}`
    );
    return response.exercise_templates || [];
  }

  async getExerciseTemplate(id: string): Promise<ExerciseTemplate> {
    return this.request<ExerciseTemplate>(`/v1/exercise_templates/${encodeURIComponent(id)}`);
  }

  async getExerciseProgress(params: ExerciseProgressParams): Promise<ExerciseProgress[]> {
    const { exercise_template_id, start_date, end_date, limit = 50 } = params;

    const queryParams = new URLSearchParams({
      limit: String(limit),
    });

    if (start_date) {
      queryParams.append('start_date', start_date);
    }
    if (end_date) {
      queryParams.append('end_date', end_date);
    }

    const endpoint = `/v1/exercises/${encodeURIComponent(exercise_template_id)}/progress?${queryParams.toString()}`;
    const response = await this.request<{ progress: ExerciseProgress[] }>(endpoint);
    return response.progress || [];
  }

  async getExerciseStats(exerciseTemplateId: string): Promise<ExerciseStats> {
    return this.request<ExerciseStats>(
      `/v1/exercises/${encodeURIComponent(exerciseTemplateId)}/stats`
    );
  }

  // ===== Folder Methods =====

  async getRoutineFolders(): Promise<RoutineFolder[]> {
    const response = await this.request<{ routine_folders: RoutineFolder[] }>(
      '/v1/routine_folders'
    );
    return response.routine_folders || [];
  }

  async getRoutineFolder(id: string): Promise<RoutineFolder> {
    return this.request<RoutineFolder>(`/v1/routine_folders/${encodeURIComponent(id)}`);
  }

  async createRoutineFolder(data: CreateFolderInput): Promise<RoutineFolder> {
    return this.request<RoutineFolder>('/v1/routine_folders', {
      method: 'POST',
      body: JSON.stringify({ routine_folder: this.cleanPayload(data) }),
    });
  }

  async updateRoutineFolder(id: string, data: CreateFolderInput): Promise<RoutineFolder> {
    return this.request<RoutineFolder>(`/v1/routine_folders/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ routine_folder: this.cleanPayload(data) }),
    });
  }

  async deleteRoutineFolder(id: string): Promise<void> {
    await this.request(`/v1/routine_folders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ===== Webhook Methods =====

  async getWebhookSubscription(): Promise<WebhookSubscription | null> {
    try {
      return await this.request<WebhookSubscription>('/v1/webhooks/subscription');
    } catch (error) {
      // Return null if no subscription exists (404)
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async createWebhookSubscription(data: CreateWebhookInput): Promise<WebhookSubscription> {
    const response = await this.request<{ webhook: WebhookSubscription[] }>('/v1/webhooks/subscription', {
      method: 'POST',
      body: JSON.stringify({ webhook: this.cleanPayload(data) }),
    });
    // API returns { webhook: [{ ... }] }, extract first element
    return response.webhook[0];
  }

  async deleteWebhookSubscription(): Promise<void> {
    await this.request('/v1/webhooks/subscription', {
      method: 'DELETE',
    });
  }
}
