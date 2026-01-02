/**
 * Reusable OpenAPI Schema Definitions
 * These schemas are referenced throughout the API documentation
 */

module.exports = {
  // ============================================
  // Common Response Schemas
  // ============================================
  Error: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string', example: 'An error occurred' },
      errorCode: { type: 'string', example: 'VALIDATION_ERROR' }
    }
  },
  Success: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Operation completed successfully' }
    }
  },
  PaginatedResponse: {
    type: 'object',
    properties: {
      data: { type: 'array', items: { type: 'object' } },
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      total: { type: 'integer', example: 100 },
      totalPages: { type: 'integer', example: 5 }
    }
  },

  // ============================================
  // Authentication Schemas
  // ============================================
  SignupRequest: {
    type: 'object',
    required: ['email', 'password', 'phoneNumber', 'firstName', 'lastName'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      password: { type: 'string', minLength: 8, example: 'SecurePass123!' },
      phoneNumber: { type: 'string', example: '+14155551234' },
      firstName: { type: 'string', example: 'John' },
      lastName: { type: 'string', example: 'Doe' },
      fitnessGoal: { type: 'string', example: 'muscle_gain' },
      age: { type: 'integer', example: 28 },
      weight: { type: 'number', example: 175 },
      height: { type: 'number', example: 70 },
      gender: { type: 'string', enum: ['male', 'female', 'other'] },
      fitnessLevel: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      preferredLoginMethod: { type: 'string', enum: ['email', 'phone'], default: 'email' }
    }
  },
  SigninRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      password: { type: 'string', minLength: 8, example: 'SecurePass123!' }
    }
  },
  TokenPair: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      userId: { type: 'integer', example: 123 }
    }
  },
  MFAChallenge: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      mfaRequired: { type: 'boolean', example: true },
      mfaSessionToken: { type: 'string', example: 'mfa_session_token_here' },
      userId: { type: 'integer', example: 123 },
      message: { type: 'string', example: 'MFA verification required' }
    }
  },
  RefreshTokenRequest: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }
    }
  },
  AuthStatus: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      authStatus: {
        type: 'object',
        properties: {
          email: { type: 'string', example: 'user@example.com' },
          phoneNumber: { type: 'string', example: '+1415***1234' },
          phoneVerified: { type: 'boolean', example: true },
          emailVerified: { type: 'boolean', example: true },
          mfaEnabled: { type: 'boolean', example: false },
          mfaMethod: { type: 'string', example: 'sms' },
          biometricEnabled: { type: 'boolean', example: false },
          preferredLoginMethod: { type: 'string', example: 'email' }
        }
      }
    }
  },

  // ============================================
  // OTP Schemas
  // ============================================
  SendOTPRequest: {
    type: 'object',
    required: ['phoneNumber', 'purpose'],
    properties: {
      phoneNumber: { type: 'string', example: '+14155551234' },
      purpose: { type: 'string', enum: ['signin', 'verification', 'mfa', 'signup'], example: 'verification' }
    }
  },
  SendEmailOTPRequest: {
    type: 'object',
    required: ['email', 'purpose'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      purpose: { type: 'string', enum: ['signin', 'verification', 'mfa', 'password_reset'], example: 'verification' }
    }
  },
  VerifyOTPRequest: {
    type: 'object',
    required: ['code', 'purpose'],
    properties: {
      phoneNumber: { type: 'string', example: '+14155551234' },
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      code: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
      purpose: { type: 'string', example: 'verification' }
    }
  },
  OTPResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'OTP sent successfully' },
      remainingAttempts: { type: 'integer', example: 4 }
    }
  },

  // ============================================
  // MFA Schemas
  // ============================================
  SetupMFARequest: {
    type: 'object',
    required: ['method'],
    properties: {
      method: { type: 'string', enum: ['sms', 'email'], example: 'sms' },
      code: { type: 'string', minLength: 6, maxLength: 6, example: '123456' }
    }
  },
  VerifyMFALoginRequest: {
    type: 'object',
    required: ['userId', 'mfaSessionToken', 'code', 'method'],
    properties: {
      userId: { type: 'integer', example: 123 },
      mfaSessionToken: { type: 'string', example: 'mfa_session_token_here' },
      code: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
      method: { type: 'string', enum: ['sms', 'email'], example: 'sms' }
    }
  },

  // ============================================
  // Password Reset Schemas
  // ============================================
  ForgotPasswordRequest: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' }
    }
  },
  ResetPasswordRequest: {
    type: 'object',
    required: ['email', 'code', 'newPassword'],
    properties: {
      email: { type: 'string', format: 'email', example: 'user@example.com' },
      code: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
      newPassword: { type: 'string', minLength: 8, example: 'NewSecurePass456!' },
      useTwilio: { type: 'boolean', example: true }
    }
  },

  // ============================================
  // User Profile Schemas
  // ============================================
  UserProfile: {
    type: 'object',
    properties: {
      FirstName: { type: 'string', example: 'John' },
      LastName: { type: 'string', example: 'Doe' },
      FitnessGoal: { type: 'string', example: 'muscle_gain' },
      Age: { type: 'integer', example: 28 },
      Weight: { type: 'number', example: 175 },
      Height: { type: 'number', example: 70 },
      Gender: { type: 'string', example: 'male' },
      FitnessLevel: { type: 'string', example: 'intermediate' },
      ProfileImageUrl: { type: 'string', format: 'uri', example: 'https://storage.example.com/profile.jpg' }
    }
  },
  UpdateProfileRequest: {
    type: 'object',
    properties: {
      firstName: { type: 'string', example: 'John' },
      lastName: { type: 'string', example: 'Doe' },
      fitnessGoal: { type: 'string', example: 'muscle_gain' },
      age: { type: 'integer', example: 28 },
      weight: { type: 'number', example: 175 },
      height: { type: 'number', example: 70 },
      gender: { type: 'string', example: 'male' },
      fitnessLevel: { type: 'string', example: 'intermediate' }
    }
  },

  // ============================================
  // Daily Log Schemas
  // ============================================
  DailyLog: {
    type: 'object',
    properties: {
      LogID: { type: 'integer', example: 1 },
      UserID: { type: 'integer', example: 123 },
      EffectiveDate: { type: 'string', format: 'date', example: '2025-01-01' },
      Sleep: { type: 'number', example: 7.5 },
      Steps: { type: 'integer', example: 10000 },
      Heartrate: { type: 'integer', example: 72 },
      WaterIntake: { type: 'number', example: 2.5 },
      SleepQuality: { type: 'string', example: 'good' },
      CaloriesBurned: { type: 'integer', example: 2500 },
      RestingHeartrate: { type: 'integer', example: 60 },
      HeartrateVariability: { type: 'integer', example: 45 },
      Weight: { type: 'number', example: 175 },
      CreatedAt: { type: 'string', format: 'date-time' },
      UpdatedAt: { type: 'string', format: 'date-time' }
    }
  },
  CreateDailyLogRequest: {
    type: 'object',
    properties: {
      effectiveDate: { type: 'string', format: 'date', example: '2025-01-01' },
      sleep: { type: 'number', example: 7.5 },
      steps: { type: 'integer', example: 10000 },
      heartrate: { type: 'integer', example: 72 },
      waterIntake: { type: 'number', example: 2.5 },
      sleepQuality: { type: 'string', example: 'good' },
      caloriesBurned: { type: 'integer', example: 2500 },
      restingHeartRate: { type: 'integer', example: 60 },
      heartrateVariability: { type: 'integer', example: 45 },
      weight: { type: 'number', example: 175 }
    }
  },

  // ============================================
  // Exercise Schemas
  // ============================================
  Exercise: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'ex_001' },
      name: { type: 'string', example: 'Bench Press' },
      target: { type: 'string', example: 'chest' },
      bodyPart: { type: 'string', example: 'chest' },
      equipment: { type: 'string', example: 'barbell' },
      gifUrl: { type: 'string', format: 'uri' },
      instructions: { type: 'array', items: { type: 'string' } }
    }
  },
  ExerciseExistence: {
    type: 'object',
    properties: {
      ExerciseExistenceID: { type: 'integer', example: 1 },
      ExerciseID: { type: 'string', example: 'ex_001' },
      ExerciseName: { type: 'string', example: 'Bench Press' },
      WorkoutRoutineID: { type: 'integer', example: 1 },
      Sets: { type: 'integer', example: 3 },
      Reps: { type: 'integer', example: 10 },
      Weight: { type: 'number', example: 135 },
      Duration: { type: 'integer', example: 0 },
      Completed: { type: 'boolean', example: false },
      Notes: { type: 'string', example: 'Felt strong today' }
    }
  },
  CreateExerciseExistenceRequest: {
    type: 'object',
    required: ['exerciseId', 'exerciseName', 'workoutRoutineId'],
    properties: {
      exerciseId: { type: 'string', example: 'ex_001' },
      exerciseName: { type: 'string', example: 'Bench Press' },
      workoutRoutineId: { type: 'integer', example: 1 },
      sets: { type: 'integer', example: 3 },
      reps: { type: 'integer', example: 10 },
      weight: { type: 'number', example: 135 },
      duration: { type: 'integer', example: 0 },
      completed: { type: 'boolean', example: false },
      notes: { type: 'string', example: '' }
    }
  },

  // ============================================
  // Workout Routine Schemas
  // ============================================
  WorkoutRoutine: {
    type: 'object',
    properties: {
      WorkoutRoutineID: { type: 'integer', example: 1 },
      UserID: { type: 'integer', example: 123 },
      WorkoutName: { type: 'string', example: 'Push Day' },
      WorkoutRoutineDate: { type: 'string', format: 'date', example: '2025-01-01' },
      ExerciseInstances: { type: 'string', example: '1,2,3' },
      Equipment: { type: 'string', example: 'barbell,dumbbell' },
      Duration: { type: 'integer', example: 60 },
      CaloriesBurned: { type: 'integer', example: 500 },
      Intensity: { type: 'integer', example: 7 },
      Load: { type: 'number', example: 15000 },
      DurationLeft: { type: 'integer', example: 0 },
      Completed: { type: 'boolean', example: false },
      CreatedAt: { type: 'string', format: 'date-time' }
    }
  },
  CreateWorkoutRoutineRequest: {
    type: 'object',
    required: ['workoutName', 'workoutRoutineDate'],
    properties: {
      workoutName: { type: 'string', example: 'Push Day' },
      workoutRoutineDate: { type: 'string', format: 'date', example: '2025-01-01' },
      exerciseInstances: { type: 'string', description: 'Comma-separated exercise instance IDs', example: '1,2,3' },
      equipment: { type: 'string', example: 'barbell,dumbbell' },
      duration: { type: 'integer', description: 'Duration in minutes', example: 60 },
      caloriesBurned: { type: 'integer', example: 500 },
      intensity: { type: 'integer', description: 'Intensity level 1-10', example: 7 },
      load: { type: 'number', description: 'Total load volume', example: 15000 },
      durationLeft: { type: 'integer', example: 0 },
      completed: { type: 'boolean', example: false }
    }
  },

  // ============================================
  // Mesocycle/Microcycle Schemas
  // ============================================
  Mesocycle: {
    type: 'object',
    properties: {
      MesocycleID: { type: 'integer', example: 1 },
      UserID: { type: 'integer', example: 123 },
      Name: { type: 'string', example: 'Strength Block' },
      StartDate: { type: 'string', format: 'date' },
      EndDate: { type: 'string', format: 'date' },
      Goal: { type: 'string', example: 'Build strength' },
      Status: { type: 'string', enum: ['active', 'completed', 'planned'] }
    }
  },
  Microcycle: {
    type: 'object',
    properties: {
      MicrocycleID: { type: 'integer', example: 1 },
      MesocycleID: { type: 'integer', example: 1 },
      WeekNumber: { type: 'integer', example: 1 },
      StartDate: { type: 'string', format: 'date' },
      EndDate: { type: 'string', format: 'date' },
      Focus: { type: 'string', example: 'Volume accumulation' }
    }
  },

  // ============================================
  // Subscription Schemas
  // ============================================
  Subscription: {
    type: 'object',
    properties: {
      subscriptionId: { type: 'string', example: 'sub_1234567890' },
      status: { type: 'string', enum: ['active', 'paused', 'cancelled', 'past_due', 'trialing'] },
      currentPeriodStart: { type: 'string', format: 'date-time' },
      currentPeriodEnd: { type: 'string', format: 'date-time' },
      planType: { type: 'string', example: 'premium_monthly' },
      cancelAtPeriodEnd: { type: 'boolean', example: false }
    }
  },
  SubscriptionStatus: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      subscription: { $ref: '#/components/schemas/Subscription' },
      userType: { type: 'string', enum: ['free', 'premium'] }
    }
  },
  InitializePaymentRequest: {
    type: 'object',
    required: ['planType'],
    properties: {
      planType: { type: 'string', enum: ['premium_monthly', 'premium_yearly'], example: 'premium_monthly' },
      paymentMethodId: { type: 'string', example: 'pm_card_visa' }
    }
  },
  ChangePlanRequest: {
    type: 'object',
    required: ['newPlanType'],
    properties: {
      newPlanType: { type: 'string', enum: ['premium_monthly', 'premium_yearly'], example: 'premium_yearly' }
    }
  },

  // ============================================
  // Chatbot Schemas
  // ============================================
  ChatMessage: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['user', 'assistant'], example: 'user' },
      content: { type: 'string', example: 'Create a workout plan for muscle gain' },
      timestamp: { type: 'string', format: 'date-time' }
    }
  },
  ChatRequest: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', example: 'Create a 4-day workout plan for muscle gain' },
      sessionId: { type: 'string', example: 'session_123' },
      inquiryType: { type: 'string', enum: ['general', 'workout'], example: 'workout' }
    }
  },
  ChatResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      response: {
        type: 'object',
        properties: {
          message: { type: 'object' },
          payload: { type: 'object' }
        }
      },
      sessionId: { type: 'string' }
    }
  },

  // ============================================
  // AI Workout Plan Schemas
  // ============================================
  AIWorkoutPlan: {
    type: 'object',
    properties: {
      PlanID: { type: 'string', example: 'plan_123_1704067200' },
      UserID: { type: 'integer', example: 123 },
      ChatSessionID: { type: 'string' },
      PlanData: { type: 'string', description: 'JSON string of workout days' },
      Summary: { type: 'string' },
      Goal: { type: 'string', example: 'muscle_gain' },
      DaysPerWeek: { type: 'integer', example: 4 },
      DurationWeeks: { type: 'integer', example: 8 },
      Split: { type: 'string', example: 'Push-Pull-Legs' },
      Status: { type: 'string', enum: ['draft', 'active', 'completed', 'archived'] },
      CreatedAt: { type: 'string', format: 'date-time' }
    }
  },
  UpdatePlanStatusRequest: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['draft', 'active', 'completed', 'archived'], example: 'active' }
    }
  },

  // ============================================
  // Usage Schemas
  // ============================================
  UsageStats: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      usage: {
        type: 'object',
        properties: {
          generalInquiries: { type: 'integer', example: 3 },
          workoutInquiries: { type: 'integer', example: 1 },
          generalRemaining: { type: 'integer', example: 2 },
          workoutRemaining: { type: 'integer', example: 2 },
          weekStart: { type: 'string', format: 'date' }
        }
      },
      userType: { type: 'string', enum: ['free', 'premium'] }
    }
  }
};

