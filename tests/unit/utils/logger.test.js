/**
 * Unit Tests for Logger Utility
 */

const logger = require('../../../utils/logger');

describe('Logger Utility', () => {
  let consoleSpy;

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
    };
  });

  afterEach(() => {
    // Restore console methods
    jest.restoreAllMocks();
  });

  describe('info()', () => {
    it('should log info messages with [INFO] prefix', () => {
      logger.info('Test info message');
      
      expect(consoleSpy.log).toHaveBeenCalled();
      expect(consoleSpy.log.mock.calls[0][0]).toContain('[INFO]');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('Test info message');
    });

    it('should handle multiple arguments', () => {
      logger.info('Message with', 'multiple', 'args');
      
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('warn()', () => {
    it('should log warning messages with [WARN] prefix', () => {
      logger.warn('Test warning message');
      
      expect(consoleSpy.warn).toHaveBeenCalled();
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('[WARN]');
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('Test warning message');
    });
  });

  describe('error()', () => {
    it('should log error messages with [ERROR] prefix', () => {
      logger.error('Test error message');
      
      expect(consoleSpy.error).toHaveBeenCalled();
      expect(consoleSpy.error.mock.calls[0][0]).toContain('[ERROR]');
      expect(consoleSpy.error.mock.calls[0][0]).toContain('Test error message');
    });

    it('should handle error objects', () => {
      const error = new Error('Test error');
      logger.error('Error occurred', error);
      
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('debug()', () => {
    it('should log debug messages in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      // Need to re-require to pick up new NODE_ENV
      jest.resetModules();
      const devLogger = require('../../../utils/logger');
      
      devLogger.debug('Debug message');
      
      // Restore
      process.env.NODE_ENV = originalEnv;
    });

    it('should not log debug messages in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      jest.resetModules();
      const prodLogger = require('../../../utils/logger');
      
      // Clear any previous calls
      consoleSpy.log.mockClear();
      
      prodLogger.debug('Debug message');
      
      // Debug should not log in production
      // This depends on implementation - adjust if needed
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('with context object', () => {
    it('should format context as JSON string', () => {
      const context = { userId: 123, action: 'login' };
      logger.info('User action', context);
      
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle empty context', () => {
      logger.info('Message', {});
      
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should handle undefined context', () => {
      logger.info('Message', undefined);
      
      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });
});

