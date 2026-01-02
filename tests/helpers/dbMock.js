/**
 * Database Mocking Utilities
 * Provides mocks for database operations in tests
 */

// Mock database pool
const createMockPool = () => {
  const mockRequest = {
    input: jest.fn().mockReturnThis(),
    query: jest.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
  };

  return {
    request: jest.fn(() => mockRequest),
    transaction: jest.fn(() => ({
      begin: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
    })),
    connected: true,
    close: jest.fn().mockResolvedValue(),
  };
};

// Mock getPool function
const mockGetPool = () => {
  const mockPool = createMockPool();
  return jest.fn(() => mockPool);
};

// Mock user data for tests
const mockUsers = {
  validUser: {
    UserID: 1,
    Email: 'test@example.com',
    Password: '$2b$12$hashedPasswordHere', // bcrypt hash
    MFAEnabled: false,
    MFAMethod: null,
    BiometricEnabled: false,
    PreferredLoginMethod: 'email',
    PhoneNumber: '+14155551234',
    PhoneVerified: true,
  },
  mfaUser: {
    UserID: 2,
    Email: 'mfa@example.com',
    Password: '$2b$12$hashedPasswordHere',
    MFAEnabled: true,
    MFAMethod: 'sms',
    BiometricEnabled: false,
    PreferredLoginMethod: 'email',
    PhoneNumber: '+14155551235',
    PhoneVerified: true,
  },
  premiumUser: {
    UserID: 3,
    Email: 'premium@example.com',
    Password: '$2b$12$hashedPasswordHere',
    MFAEnabled: false,
    BiometricEnabled: false,
    PreferredLoginMethod: 'email',
    UserType: 'Premium',
  },
};

// Mock daily log data
const mockDailyLogs = [
  {
    LogID: 1,
    UserID: 1,
    EffectiveDate: '2025-01-01',
    Sleep: 7.5,
    Steps: 10000,
    Heartrate: 72,
    WaterIntake: 2.5,
    CaloriesBurned: 2500,
  },
];

// Mock workout routine data
const mockWorkoutRoutines = [
  {
    WorkoutRoutineID: 1,
    UserID: 1,
    RoutineName: 'Push Day',
    WorkoutRoutineDate: '2025-01-01',
    Description: 'Chest, shoulders, triceps',
  },
];

// Setup mock database queries
const setupMockQueries = (mockPool, options = {}) => {
  const mockRequest = mockPool.request();
  
  mockRequest.query.mockImplementation((query) => {
    // Route queries based on content
    if (query.includes('UserLogin') && query.includes('SELECT')) {
      return Promise.resolve({ 
        recordset: options.userNotFound ? [] : [mockUsers.validUser] 
      });
    }
    if (query.includes('DailyLogs') && query.includes('SELECT')) {
      return Promise.resolve({ recordset: mockDailyLogs });
    }
    if (query.includes('WorkoutRoutine') && query.includes('SELECT')) {
      return Promise.resolve({ recordset: mockWorkoutRoutines });
    }
    if (query.includes('INSERT')) {
      return Promise.resolve({ 
        recordset: [{ UserID: options.newUserId || 100 }],
        rowsAffected: [1] 
      });
    }
    if (query.includes('UPDATE')) {
      return Promise.resolve({ rowsAffected: [1] });
    }
    if (query.includes('DELETE')) {
      return Promise.resolve({ rowsAffected: [1] });
    }
    return Promise.resolve({ recordset: [], rowsAffected: [0] });
  });

  return mockRequest;
};

module.exports = {
  createMockPool,
  mockGetPool,
  mockUsers,
  mockDailyLogs,
  mockWorkoutRoutines,
  setupMockQueries,
};

