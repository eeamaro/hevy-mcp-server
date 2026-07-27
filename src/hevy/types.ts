// Hevy API Type Definitions

export interface HevyConfig {
  apiKey: string;
  baseUrl?: string;
}

// Workout Types
export interface Workout {
  id: string;
  title: string;
  description?: string;
  start_time: string;  // ISO 8601
  end_time: string;    // ISO 8601
  exercises: WorkoutExercise[];
  updated_at?: string;
  created_at?: string;
}

export interface WorkoutExercise {
  exercise_template_id: string;
  superset_id?: string | number | null;
  notes?: string;
  sets: ExerciseSet[];
}

export interface ExerciseSet {
  type: 'normal' | 'warmup' | 'dropset' | 'failure';
  weight_kg?: number | null;
  reps?: number | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  rpe?: number | null;
}

export interface CreateWorkoutInput {
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  exercises: WorkoutExercise[];
}

export interface UpdateWorkoutInput {
  title?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  exercises?: WorkoutExercise[];
}

export interface WorkoutCountResponse {
  workout_count: number;
}

export interface WorkoutEvent {
  id: string;
  workout_id: string;
  event_type: 'created' | 'updated' | 'deleted';
  timestamp: string;
}

// Routine Types
export interface Routine {
  id: string;
  title: string;
  folder_id?: string | null;
  exercises: RoutineExercise[];
  created_at?: string;
  updated_at?: string;
}

export interface RoutineExercise {
  exercise_template_id: string;
  title?: string;
  superset_id?: string | number | null;
  notes?: string;
  sets: RoutineSet[];
  rest_seconds?: number | null;
}

export interface RoutineSet {
  type: 'normal' | 'warmup' | 'dropset' | 'failure';
  weight_kg?: number | null;
  reps?: number | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  rpe?: number | null;
}

export interface CreateRoutineInput {
  title: string;
  folder_id?: string | null;
  exercises: RoutineExercise[];
}

export interface UpdateRoutineInput {
  title?: string;
  exercises?: RoutineExercise[];
}

// Exercise Types
export interface ExerciseTemplate {
  id: string;
  title: string;
  primary_muscle_group: string;
  secondary_muscle_groups: string[];
  is_custom: boolean;
  equipment?: string;
  movement_pattern?: string;
}

export interface ExerciseProgress {
  exercise_template_id: string;
  date: string;
  sets: ExerciseSet[];
  workout_id: string;
}

export interface ExerciseStats {
  exercise_template_id: string;
  personal_records: PersonalRecord[];
  one_rep_max_kg?: number;
  total_volume_kg?: number;
  total_reps?: number;
}

export interface PersonalRecord {
  type: 'weight' | 'reps' | 'volume' | 'distance' | 'duration';
  value: number;
  unit: string;
  date: string;
  workout_id: string;
}

// Folder Types
export interface RoutineFolder {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateFolderInput {
  title: string;
}

// Webhook Types
export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  created_at?: string;
}

export type WebhookEvent =
  | 'workout.created'
  | 'workout.updated'
  | 'workout.deleted'
  | 'routine.created'
  | 'routine.updated'
  | 'routine.deleted';

export interface CreateWebhookInput {
  url: string;
  events: WebhookEvent[];
}

// API Response Types
export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface ApiError {
  error: string;
  message: string;
  status_code: number;
}

// Query Parameter Types
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface WorkoutQueryParams extends PaginationParams {
  startDate?: string;
  endDate?: string;
}

export interface ExerciseProgressParams {
  exercise_template_id: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
}
