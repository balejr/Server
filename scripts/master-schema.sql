-- ===========================================
-- ApogeeHnP Master Database Schema
-- ===========================================
-- Run via: node scripts/run-schema.js
-- 
-- This file creates all database tables required for a fresh installation.
-- All migrations have been consolidated into this single file.
-- 
-- Last updated: January 2026
-- ===========================================

-- ============================================
-- CORE USER TABLES
-- ============================================
-- NOTE: UserProfile is the parent table (has IDENTITY).
-- UserLogin references UserProfile (1:1 relationship).
-- This allows creating a profile first, then adding login credentials.

-- UserProfile: User data, fitness info, subscription status (PARENT TABLE)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserProfile')
BEGIN
    CREATE TABLE [dbo].[UserProfile] (
        UserID INT IDENTITY(1,1) PRIMARY KEY,
        FirstName NVARCHAR(100) NULL,
        LastName NVARCHAR(100) NULL,
        FitnessGoal NVARCHAR(50) NULL,
        Age INT NULL,
        Weight DECIMAL(5,2) NULL,
        Height DECIMAL(5,2) NULL,
        BodyFat DECIMAL(5,2) NULL,
        Muscle DECIMAL(5,2) NULL,
        Gender NVARCHAR(20) NULL,
        FitnessLevel NVARCHAR(20) NULL,
        ProfileImageUrl NVARCHAR(500) NULL,
        
        -- Phone verification
        PhoneNumber NVARCHAR(20) NULL,
        PhoneVerified BIT DEFAULT 0,
        
        -- Subscription status
        UserType NVARCHAR(20) DEFAULT 'free',
        UserTypeChangedDate DATETIMEOFFSET NULL
    );
    PRINT 'Created UserProfile table';
END

-- UserLogin: Authentication credentials, tokens, MFA settings
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserLogin')
BEGIN
    CREATE TABLE [dbo].[UserLogin] (
        UserID INT PRIMARY KEY,
        Email NVARCHAR(255) NOT NULL,
        Password NVARCHAR(500) NOT NULL,
        CreateDate DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        -- Authentication preferences
        PreferredLoginMethod NVARCHAR(20) DEFAULT 'email',
        
        -- MFA settings
        MFAEnabled BIT DEFAULT 0,
        MFAMethod NVARCHAR(20) NULL,
        MFASessionToken NVARCHAR(100) NULL,
        MFASessionExpires DATETIMEOFFSET NULL,
        
        -- Biometric authentication
        BiometricEnabled BIT DEFAULT 0,
        BiometricToken NVARCHAR(500) NULL,
        
        -- Refresh token (single-device architecture)
        RefreshToken NVARCHAR(500) NULL,
        RefreshTokenExpires DATETIMEOFFSET NULL,
        RefreshTokenVersion INT DEFAULT 1,
        
        -- Session invalidation
        TokenInvalidatedAt DATETIMEOFFSET NULL,
        
        -- Password reset
        PasswordResetToken NVARCHAR(100) NULL,
        PasswordResetExpires DATETIMEOFFSET NULL,
        
        -- Foreign key to UserProfile
        CONSTRAINT FK_UserLogin_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID),
        
        -- Constraints
        CONSTRAINT CK_PreferredLoginMethod 
            CHECK (PreferredLoginMethod IN ('email', 'phone', 'biometric')),
        CONSTRAINT CK_MFAMethod 
            CHECK (MFAMethod IS NULL OR MFAMethod IN ('sms', 'email'))
    );
    PRINT 'Created UserLogin table';
END

-- ============================================
-- AUTHENTICATION SUPPORT TABLES
-- ============================================

-- OTPVerifications: OTP tracking and rate limiting
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OTPVerifications')
BEGIN
    CREATE TABLE [dbo].[OTPVerifications] (
        VerificationID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NULL,  -- Nullable for pre-signup OTP requests
        PhoneOrEmail NVARCHAR(255) NOT NULL,
        VerificationSID NVARCHAR(100) NULL,
        Purpose NVARCHAR(50) NOT NULL,
        Status NVARCHAR(20) DEFAULT 'pending',
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        ExpiresAt DATETIMEOFFSET NULL,
        AttemptCount INT DEFAULT 0,
        
        -- Constraints
        CONSTRAINT CK_OTP_Purpose
            CHECK (Purpose IN ('login', 'signin', 'signup', 'mfa', 'password_reset', 'phone_verify', 'verification')),
        CONSTRAINT CK_OTP_Status
            CHECK (Status IN ('pending', 'approved', 'expired', 'failed'))
    );
    PRINT 'Created OTPVerifications table';
END

-- PasswordResets: Password reset token tracking
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PasswordResets')
BEGIN
    CREATE TABLE [dbo].[PasswordResets] (
        ResetID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        Code NVARCHAR(100) NOT NULL,
        ExpiresAt DATETIMEOFFSET NOT NULL,
        LastModified DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        Used BIT DEFAULT 0,
        
        CONSTRAINT FK_PasswordResets_UserLogin 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserLogin](UserID)
    );
    PRINT 'Created PasswordResets table';
END

-- ============================================
-- HEALTH & FITNESS DATA TABLES
-- ============================================

-- DailyLogs: Daily health metrics
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailyLogs')
BEGIN
    CREATE TABLE [dbo].[DailyLogs] (
        LogID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        EffectiveDate DATE NOT NULL,
        Sleep DECIMAL(4,2) NULL,
        Steps INT NULL,
        Heartrate INT NULL,
        WaterIntake DECIMAL(4,2) NULL,
        SleepQuality NVARCHAR(20) NULL,
        CaloriesBurned INT NULL,
        RestingHeartRate INT NULL,
        HeartrateVariability INT NULL,
        Weight DECIMAL(5,2) NULL,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        UpdatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_DailyLogs_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created DailyLogs table';
END

-- DailySummary: Aggregated daily stats
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DailySummary')
BEGIN
    CREATE TABLE [dbo].[DailySummary] (
        SummaryID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        SummaryDate DATE NOT NULL,
        TotalWorkouts INT DEFAULT 0,
        TotalCaloriesBurned INT DEFAULT 0,
        TotalDuration INT DEFAULT 0,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_DailySummary_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created DailySummary table';
END

-- ============================================
-- EXERCISE & WORKOUT TABLES
-- ============================================

-- Exercise: Master exercise library
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Exercise')
BEGIN
    CREATE TABLE [dbo].[Exercise] (
        MasterExerciseID INT IDENTITY(1,1) PRIMARY KEY,
        ExerciseId NVARCHAR(100) NOT NULL,
        ExerciseName NVARCHAR(255) NOT NULL,
        TargetMuscle NVARCHAR(100) NULL,
        Instructions NVARCHAR(MAX) NULL,
        Equipment NVARCHAR(100) NULL,
        ImageURL NVARCHAR(500) NULL
    );
    PRINT 'Created Exercise table';
END

-- ExerciseExistence: User's logged exercises
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ExerciseExistence')
BEGIN
    CREATE TABLE [dbo].[ExerciseExistence] (
        ExerciseExistenceID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        ExerciseID NVARCHAR(100) NOT NULL,
        ExerciseName NVARCHAR(255) NOT NULL,
        WorkoutRoutineID INT NULL,
        Sets INT NULL,
        Reps INT NULL,
        Weight DECIMAL(6,2) NULL,
        Duration INT NULL,
        RPE INT NULL,
        Completed BIT DEFAULT 0,
        Notes NVARCHAR(500) NULL,
        Date DATE NULL,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_ExerciseExistence_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created ExerciseExistence table';
END

-- WorkoutRoutine: Workout sessions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WorkoutRoutine')
BEGIN
    CREATE TABLE [dbo].[WorkoutRoutine] (
        WorkoutRoutineID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        WorkoutName NVARCHAR(255) NOT NULL,
        WorkoutRoutineDate DATE NOT NULL,
        ExerciseInstances NVARCHAR(500) NULL,
        Equipment NVARCHAR(500) NULL,
        Duration INT NULL,
        CaloriesBurned INT NULL,
        Intensity INT NULL,
        Load DECIMAL(10,2) NULL,
        DurationLeft INT NULL,
        Completed BIT DEFAULT 0,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_WorkoutRoutine_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created WorkoutRoutine table';
END

-- WorkoutHistory: Historical workout records
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WorkoutHistory')
BEGIN
    CREATE TABLE [dbo].[WorkoutHistory] (
        HistoryID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        WorkoutRoutineID INT NULL,
        CompletedDate DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        Duration INT NULL,
        CaloriesBurned INT NULL,
        Notes NVARCHAR(500) NULL,
        
        CONSTRAINT FK_WorkoutHistory_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created WorkoutHistory table';
END

-- ============================================
-- TRAINING CYCLE TABLES
-- ============================================

-- Mesocycles: Training blocks (4-8 weeks)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'mesocycles')
BEGIN
    CREATE TABLE [dbo].[mesocycles] (
        mesocycle_id INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_current BIT DEFAULT 1,
        created_date DATETIME2 DEFAULT SYSDATETIME(),
        
        CONSTRAINT FK_Mesocycles_UserProfile 
            FOREIGN KEY (UserId) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created mesocycles table';
END

-- Microcycles: Weekly training cycles
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'microcycles')
BEGIN
    CREATE TABLE [dbo].[microcycles] (
        microcycle_id INT IDENTITY(1,1) PRIMARY KEY,
        mesocycle_id INT NOT NULL,
        userID INT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_current BIT DEFAULT 0,
        created_date DATETIME2 DEFAULT SYSDATETIME(),
        
        CONSTRAINT FK_Microcycles_Mesocycles 
            FOREIGN KEY (mesocycle_id) REFERENCES [dbo].[mesocycles](mesocycle_id)
    );
    PRINT 'Created microcycles table';
END

-- ============================================
-- AI & CHATBOT TABLES
-- ============================================

-- ChatbotSession: Chat session management
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ChatbotSession')
BEGIN
    CREATE TABLE [dbo].[ChatbotSession] (
        chatSessionID NVARCHAR(100) PRIMARY KEY,
        UserId INT NOT NULL,
        SessionType NVARCHAR(50) DEFAULT 'inquiry',
        ChatSessionStart_date DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        LastActivity DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_ChatbotSession_UserProfile 
            FOREIGN KEY (UserId) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created ChatbotSession table';
END

-- ChatMessages: Chat history
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ChatMessages')
BEGIN
    CREATE TABLE [dbo].[ChatMessages] (
        MessageID INT IDENTITY(1,1) PRIMARY KEY,
        ChatSessionID NVARCHAR(100) NOT NULL,
        UserID INT NOT NULL,
        Role NVARCHAR(20) NOT NULL,
        Content NVARCHAR(MAX) NOT NULL,
        Timestamp DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_ChatMessages_ChatbotSession 
            FOREIGN KEY (ChatSessionID) REFERENCES [dbo].[ChatbotSession](chatSessionID),
        CONSTRAINT CK_ChatMessages_Role
            CHECK (Role IN ('user', 'assistant', 'system'))
    );
    PRINT 'Created ChatMessages table';
END

-- AIWorkoutPlans: AI-generated workout plans
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AIWorkoutPlans')
BEGIN
    CREATE TABLE [dbo].[AIWorkoutPlans] (
        PlanID NVARCHAR(100) PRIMARY KEY,
        UserID INT NOT NULL,
        ChatSessionID NVARCHAR(100) NULL,
        PlanData NVARCHAR(MAX) NOT NULL,
        Summary NVARCHAR(500) NULL,
        Goal NVARCHAR(50) NULL,
        DaysPerWeek INT NULL,
        DurationWeeks INT NULL,
        Split NVARCHAR(100) NULL,
        Status NVARCHAR(20) DEFAULT 'draft',
        IsActive BIT DEFAULT 0,
        CreatedDate DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_AIWorkoutPlans_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID),
        CONSTRAINT CK_AIWorkoutPlans_Status
            CHECK (Status IN ('draft', 'saved', 'active', 'completed', 'archived'))
    );
    PRINT 'Created AIWorkoutPlans table';
END

-- ============================================
-- USAGE TRACKING TABLE
-- ============================================

-- UserUsage: Weekly AI query usage tracking
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserUsage')
BEGIN
    CREATE TABLE [dbo].[UserUsage] (
        UsageID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        GeneralInquiryCount INT DEFAULT 0,
        WorkoutInquiryCount INT DEFAULT 0,
        WeekStart DATE NOT NULL,
        
        CONSTRAINT FK_UserUsage_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created UserUsage table';
END

-- ============================================
-- SUBSCRIPTION & PAYMENT TABLES
-- ============================================

-- plans: Subscription plan definitions (must be created before user_subscriptions)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'plans')
BEGIN
    CREATE TABLE [dbo].[plans] (
        plan_code NVARCHAR(32) PRIMARY KEY,
        display_name NVARCHAR(100) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency NVARCHAR(3) NOT NULL DEFAULT 'USD',
        billing_interval NVARCHAR(32) NOT NULL,
        stripe_price_id NVARCHAR(128) NULL,
        created_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        updated_at DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT CK_plans_billing_interval
            CHECK (billing_interval IN ('month', 'year', '6_months', 'monthly', 'annual', 'semi_annual'))
    );
    PRINT 'Created plans table';
    
    -- Insert default plans
    INSERT INTO [dbo].[plans] (plan_code, display_name, amount, currency, billing_interval)
    VALUES 
        ('monthly', 'Monthly Plan', 9.99, 'USD', 'month'),
        ('semi_annual', 'Semi-Annual Plan', 49.99, 'USD', '6_months'),
        ('annual', 'Annual Plan', 99.99, 'USD', 'year');
    PRINT 'Inserted default plans';
END

-- user_subscriptions: Active subscription tracking
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_subscriptions')
BEGIN
    CREATE TABLE [dbo].[user_subscriptions] (
        UserId INT NOT NULL,
        [plan] NVARCHAR(32) NOT NULL,
        status NVARCHAR(32) NOT NULL,
        payment_intent_id NVARCHAR(128) NULL,
        started_at DATETIMEOFFSET NULL,
        updated_at DATETIMEOFFSET NULL,
        subscription_id NVARCHAR(128) NULL,
        customer_id NVARCHAR(128) NULL,
        current_period_start DATETIMEOFFSET NULL,
        current_period_end DATETIMEOFFSET NULL,
        billing_interval NVARCHAR(32) NULL,
        cancellation_scheduled BIT NULL,
        cancel_at_period_end BIT DEFAULT 0,
        payment_platform NVARCHAR(32) NULL,
        transaction_type NVARCHAR(32) NULL,
        transaction_date DATETIMEOFFSET NULL,
        
        CONSTRAINT FK_user_subscriptions_UserProfile 
            FOREIGN KEY (UserId) REFERENCES [dbo].[UserProfile](UserID),
        CONSTRAINT FK_user_subscriptions_plans
            FOREIGN KEY ([plan]) REFERENCES [dbo].[plans](plan_code),
        CONSTRAINT CK_user_subscriptions_status
            CHECK (status IN ('active', 'inactive', 'paused', 'cancelled', 'past_due', 'trialing')),
        CONSTRAINT CK_user_subscriptions_billing_interval
            CHECK (billing_interval IS NULL OR billing_interval IN ('monthly', 'semi_annual', 'annual')),
        CONSTRAINT CK_user_subscriptions_transaction_type
            CHECK (transaction_type IS NULL OR transaction_type IN (
                'activation', 'upgrade', 'downgrade', 'pause', 
                'resume', 'cancellation', 'expiration', 'renewal'
            ))
    );
    PRINT 'Created user_subscriptions table';
END

-- subscription_transactions: Subscription event audit trail
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'subscription_transactions')
BEGIN
    CREATE TABLE [dbo].[subscription_transactions] (
        transaction_id INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL,
        subscription_id NVARCHAR(128) NULL,
        transaction_type NVARCHAR(32) NOT NULL,
        transaction_date DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        
        -- Plan details at time of transaction
        from_plan NVARCHAR(32) NULL,
        to_plan NVARCHAR(32) NULL,
        billing_interval NVARCHAR(32) NULL,
        
        -- Financial details
        amount DECIMAL(10,2) NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        proration_amount DECIMAL(10,2) NULL,
        
        -- Metadata
        payment_gateway NVARCHAR(32) NULL,
        payment_intent_id NVARCHAR(128) NULL,
        cancellation_reason NVARCHAR(50) NULL,
        user_feedback NVARCHAR(500) NULL,
        
        -- Pause-specific fields
        pause_duration_months INT NULL,
        resume_date DATETIMEOFFSET NULL,
        
        CONSTRAINT FK_subscription_transactions_UserProfile 
            FOREIGN KEY (UserId) REFERENCES [dbo].[UserProfile](UserID),
        CONSTRAINT CK_subscription_transactions_type 
            CHECK (transaction_type IN (
                'activation', 'upgrade', 'downgrade', 'pause', 
                'resume', 'cancellation', 'expiration', 'renewal'
            ))
    );
    PRINT 'Created subscription_transactions table';
END

-- payments: Payment records
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payments')
BEGIN
    CREATE TABLE [dbo].[payments] (
        PaymentID INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL,
        [plan] NVARCHAR(32) NULL,
        Amount DECIMAL(10,2) NOT NULL,
        Currency VARCHAR(3) DEFAULT 'USD',
        Status NVARCHAR(50) NOT NULL,
        PaymentGateway NVARCHAR(50) NOT NULL,
        PaymentIntentId NVARCHAR(128) NULL,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_payments_UserProfile 
            FOREIGN KEY (UserId) REFERENCES [dbo].[UserProfile](UserID),
        CONSTRAINT FK_payments_plans
            FOREIGN KEY ([plan]) REFERENCES [dbo].[plans](plan_code)
    );
    PRINT 'Created payments table';
END

-- ============================================
-- ADDITIONAL FEATURE TABLES
-- ============================================

-- Achievements: Master achievement definitions (must be created before UserAchievements)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Achievements')
BEGIN
    CREATE TABLE [dbo].[Achievements] (
        AchievementID INT IDENTITY(1,1) PRIMARY KEY,
        Title NVARCHAR(255) NOT NULL,
        Description NVARCHAR(MAX) NULL,
        Category NVARCHAR(50) NOT NULL,
        Type NVARCHAR(50) NOT NULL,
        GoalValue INT NULL,
        Icon NVARCHAR(255) NULL,
        IsActive BIT DEFAULT 1,
        CreatedDate DATETIME2 DEFAULT SYSDATETIME(),
        LastModified DATETIME2 DEFAULT SYSDATETIME()
    );
    PRINT 'Created Achievements table';
END

-- UserAchievements: User's earned achievements (links users to achievements)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserAchievements')
BEGIN
    CREATE TABLE [dbo].[UserAchievements] (
        UserAchievementID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        AchievementID INT NOT NULL,
        CurrentValue INT NULL,
        IsCompleted BIT DEFAULT 0,
        CompletedDate DATETIME2 NULL,
        CreatedDate DATETIME2 DEFAULT SYSDATETIME(),
        LastModified DATETIME2 DEFAULT SYSDATETIME(),
        
        CONSTRAINT FK_UserAchievements_UserID 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID),
        CONSTRAINT FK_UserAchievements_AchievementID
            FOREIGN KEY (AchievementID) REFERENCES [dbo].[Achievements](AchievementID)
    );
    PRINT 'Created UserAchievements table';
END

-- OnboardingProfile: User onboarding data
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OnboardingProfile')
BEGIN
    CREATE TABLE [dbo].[OnboardingProfile] (
        OnboardingID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        CompletedSteps NVARCHAR(500) NULL,
        OnboardingComplete BIT DEFAULT 0,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_OnboardingProfile_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created OnboardingProfile table';
END

-- PreWorkoutAssessment: Pre-workout readiness assessment
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PreWorkoutAssessment')
BEGIN
    CREATE TABLE [dbo].[PreWorkoutAssessment] (
        AssessmentID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        AssessmentDate DATE NOT NULL,
        EnergyLevel INT NULL,
        SleepQuality INT NULL,
        StressLevel INT NULL,
        ReadinessScore INT NULL,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        
        CONSTRAINT FK_PreWorkoutAssessment_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created PreWorkoutAssessment table';
END

-- DeviceData: Connected device data
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DeviceData')
BEGIN
    CREATE TABLE [dbo].[DeviceData] (
        DeviceDataID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        DeviceType NVARCHAR(50) NOT NULL,
        DeviceId NVARCHAR(255) NULL,
        LastSyncDate DATETIMEOFFSET NULL,
        
        CONSTRAINT FK_DeviceData_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created DeviceData table';
END

-- OuraTokens: Oura ring integration tokens
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OuraTokens')
BEGIN
    CREATE TABLE [dbo].[OuraTokens] (
        TokenID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        AccessToken NVARCHAR(500) NULL,
        RefreshToken NVARCHAR(500) NULL,
        ExpiresAt DATETIMEOFFSET NULL,
        
        CONSTRAINT FK_OuraTokens_UserProfile 
            FOREIGN KEY (UserID) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created OuraTokens table';
END

-- ============================================
-- INQUIRY TABLES
-- ============================================

-- Inquiries: Persisted user inquiry history
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Inquiries')
BEGIN
    CREATE TABLE [dbo].[Inquiries] (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        UserId INT NOT NULL,
        Topic NVARCHAR(50) NOT NULL DEFAULT 'general',
        Subject NVARCHAR(255) NOT NULL DEFAULT 'FitNxt Customer Inquiry',
        Message NVARCHAR(MAX) NOT NULL,
        AttachmentCount INT NOT NULL DEFAULT 0,
        Status NVARCHAR(20) NOT NULL DEFAULT 'sent',
        CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_Inquiries_UserProfile
            FOREIGN KEY (UserId) REFERENCES [dbo].[UserProfile](UserID)
    );
    PRINT 'Created Inquiries table';
END

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- OTPVerifications indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OTPVerifications_UserID_Purpose')
BEGIN
    CREATE INDEX IX_OTPVerifications_UserID_Purpose
        ON [dbo].[OTPVerifications](UserID, Purpose);
    PRINT 'Created index IX_OTPVerifications_UserID_Purpose';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OTPVerifications_VerificationSID')
BEGIN
    CREATE INDEX IX_OTPVerifications_VerificationSID
        ON [dbo].[OTPVerifications](VerificationSID);
    PRINT 'Created index IX_OTPVerifications_VerificationSID';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_OTPVerifications_CreatedAt')
BEGIN
    CREATE INDEX IX_OTPVerifications_CreatedAt
        ON [dbo].[OTPVerifications](CreatedAt);
    PRINT 'Created index IX_OTPVerifications_CreatedAt';
END

-- UserLogin indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserLogin_Email')
BEGIN
    CREATE INDEX IX_UserLogin_Email
        ON [dbo].[UserLogin](Email);
    PRINT 'Created index IX_UserLogin_Email';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserLogin_MFASessionToken')
BEGIN
    CREATE INDEX IX_UserLogin_MFASessionToken
        ON [dbo].[UserLogin](MFASessionToken)
        WHERE MFASessionToken IS NOT NULL;
    PRINT 'Created index IX_UserLogin_MFASessionToken';
END

-- DailyLogs indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_DailyLogs_UserID_EffectiveDate')
BEGIN
    CREATE INDEX IX_DailyLogs_UserID_EffectiveDate
        ON [dbo].[DailyLogs](UserID, EffectiveDate);
    PRINT 'Created index IX_DailyLogs_UserID_EffectiveDate';
END

-- WorkoutRoutine indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_WorkoutRoutine_UserID_Date')
BEGIN
    CREATE INDEX IX_WorkoutRoutine_UserID_Date
        ON [dbo].[WorkoutRoutine](UserID, WorkoutRoutineDate);
    PRINT 'Created index IX_WorkoutRoutine_UserID_Date';
END

-- ExerciseExistence indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ExerciseExistence_UserID')
BEGIN
    CREATE INDEX IX_ExerciseExistence_UserID
        ON [dbo].[ExerciseExistence](UserID);
    PRINT 'Created index IX_ExerciseExistence_UserID';
END

-- ChatMessages indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ChatMessages_ChatSessionID')
BEGIN
    CREATE INDEX IX_ChatMessages_ChatSessionID
        ON [dbo].[ChatMessages](ChatSessionID);
    PRINT 'Created index IX_ChatMessages_ChatSessionID';
END

-- Subscription indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_user_subscriptions_subscription_id')
BEGIN
    CREATE INDEX IX_user_subscriptions_subscription_id 
        ON [dbo].[user_subscriptions](subscription_id)
        WHERE subscription_id IS NOT NULL;
    PRINT 'Created index IX_user_subscriptions_subscription_id';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_user_subscriptions_customer_id')
BEGIN
    CREATE INDEX IX_user_subscriptions_customer_id 
        ON [dbo].[user_subscriptions](customer_id)
        WHERE customer_id IS NOT NULL;
    PRINT 'Created index IX_user_subscriptions_customer_id';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_user_transaction_date')
BEGIN
    CREATE INDEX idx_user_transaction_date 
        ON [dbo].[subscription_transactions](UserId, transaction_date DESC);
    PRINT 'Created index idx_user_transaction_date';
END

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_subscription_transactions_type')
BEGIN
    CREATE INDEX idx_subscription_transactions_type 
        ON [dbo].[subscription_transactions](transaction_type);
    PRINT 'Created index idx_subscription_transactions_type';
END

-- Inquiries indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Inquiries_UserId_CreatedAt')
BEGIN
    CREATE INDEX IX_Inquiries_UserId_CreatedAt
        ON [dbo].[Inquiries](UserId, CreatedAt DESC);
    PRINT 'Created index IX_Inquiries_UserId_CreatedAt';
END

-- ============================================
-- REWARDS SYSTEM TABLES
-- ============================================

-- RewardDefinitions: Available rewards/challenges
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RewardDefinitions')
BEGIN
    CREATE TABLE [dbo].[RewardDefinitions] (
        RewardID INT IDENTITY(1,1) PRIMARY KEY,
        RewardKey NVARCHAR(50) NOT NULL UNIQUE,
        Category NVARCHAR(20) NOT NULL,
        Name NVARCHAR(100) NOT NULL,
        Description NVARCHAR(500) NULL,
        XPValue INT NOT NULL DEFAULT 0,
        RequiredCount INT DEFAULT 1,
        RequiredStreak INT NULL,
        IsActive BIT DEFAULT 1,
        CreatedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT CK_RewardCategory CHECK (Category IN ('daily', 'weekly', 'monthly', 'universal'))
    );
    PRINT 'Created RewardDefinitions table';

    -- Insert default rewards
    INSERT INTO dbo.RewardDefinitions (RewardKey, Category, Name, Description, XPValue, RequiredCount) VALUES
    -- Daily (4)
    ('daily_signin', 'daily', 'Daily Sign-In', 'Log in to the app', 10, 1),
    ('log_water', 'daily', 'Log Water Intake', 'Track your hydration', 5, 1),
    ('log_sleep', 'daily', 'Log Sleep', 'Record your sleep hours', 5, 1),
    ('daily_combo', 'daily', 'Daily Combo', 'Log Workout + Water + Sleep', 5, 1),
    -- Weekly (3)
    ('weekly_goal', 'weekly', 'Weekly Workout Goal', 'Complete your weekly workout target', 100, 5),
    ('step_streak_7', 'weekly', '7-Day Step Streak', 'Meet step goal daily for a week', 50, 7),
    ('weekly_powerup', 'weekly', 'Weekly Power-Up', 'Complete 100% of weekly goals', 150, 1),
    -- Monthly (2)
    ('challenge_complete', 'monthly', 'Complete a Challenge', 'Finish a monthly challenge', 150, 1),
    ('perfect_month', 'monthly', 'Perfect Month', 'Log every day for a month', 250, 30),
    -- Universal (7)
    ('complete_workout', 'universal', 'Complete Workout', 'Finish any workout session', 50, 1),
    ('custom_routine', 'universal', 'Create Custom Routine', 'Design your own workout', 75, 1),
    ('step_goal', 'universal', 'Hit Daily Step Goal', 'Reach your step target', 20, 1),
    ('form_ai_review', 'universal', 'AI Form Review', 'Get AI feedback on your form', 25, 1),
    ('personal_record', 'universal', 'Set a Personal Record', 'Beat your personal best', 50, 1),
    ('invite_friend', 'universal', 'Invite a Friend', 'Refer someone to Apogee', 100, 1),
    ('referral_join', 'universal', 'Friend Joins', 'Your referral signs up', 250, 1);
    PRINT 'Inserted default reward definitions';
END

-- UserRewards: Track user XP and tier
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserRewards')
BEGIN
    CREATE TABLE [dbo].[UserRewards] (
        UserRewardID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        TotalXP INT DEFAULT 0,
        CurrentTier NVARCHAR(20) DEFAULT 'BRONZE',
        LastUpdated DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT FK_UserRewards_UserProfile FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID),
        CONSTRAINT CK_UserTier CHECK (CurrentTier IN ('BRONZE', 'SILVER', 'GOLD', 'EXCLUSIVE'))
    );
    PRINT 'Created UserRewards table';
    CREATE INDEX IX_UserRewards_UserID ON dbo.UserRewards(UserID);
END

-- UserRewardProgress: Track progress on each reward
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserRewardProgress')
BEGIN
    CREATE TABLE [dbo].[UserRewardProgress] (
        ProgressID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        RewardID INT NOT NULL,
        CurrentProgress INT DEFAULT 0,
        IsCompleted BIT DEFAULT 0,
        IsClaimed BIT DEFAULT 0,
        CompletedAt DATETIMEOFFSET NULL,
        ClaimedAt DATETIMEOFFSET NULL,
        PeriodStart DATETIMEOFFSET NULL,
        CONSTRAINT FK_UserRewardProgress_User FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID),
        CONSTRAINT FK_UserRewardProgress_Reward FOREIGN KEY (RewardID) REFERENCES dbo.RewardDefinitions(RewardID)
    );
    PRINT 'Created UserRewardProgress table';
    CREATE INDEX IX_UserRewardProgress_UserID ON dbo.UserRewardProgress(UserID);
    CREATE INDEX IX_UserRewardProgress_Completed ON dbo.UserRewardProgress(UserID, IsCompleted, IsClaimed);
END

-- UserRewardHistory: Log of all XP earned
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserRewardHistory')
BEGIN
    CREATE TABLE [dbo].[UserRewardHistory] (
        HistoryID INT IDENTITY(1,1) PRIMARY KEY,
        UserID INT NOT NULL,
        RewardID INT NULL,
        XPEarned INT NOT NULL,
        Reason NVARCHAR(200) NULL,
        EarnedAt DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT FK_UserRewardHistory_User FOREIGN KEY (UserID) REFERENCES dbo.UserProfile(UserID),
        CONSTRAINT FK_UserRewardHistory_Reward FOREIGN KEY (RewardID) REFERENCES dbo.RewardDefinitions(RewardID)
    );
    PRINT 'Created UserRewardHistory table';
    CREATE INDEX IX_UserRewardHistory_UserID ON dbo.UserRewardHistory(UserID);
END

-- ============================================
-- VERIFICATION
-- ============================================

PRINT '';
PRINT '===========================================';
PRINT 'Master Schema Installation Complete!';
PRINT '===========================================';
PRINT '';
PRINT 'Tables created:';
PRINT '  - UserLogin (auth credentials)';
PRINT '  - UserProfile (user data)';
PRINT '  - OTPVerifications (OTP tracking)';
PRINT '  - PasswordResets (reset tokens)';
PRINT '  - DailyLogs (health metrics)';
PRINT '  - DailySummary (aggregated stats)';
PRINT '  - Exercise (exercise library)';
PRINT '  - ExerciseExistence (logged exercises)';
PRINT '  - WorkoutRoutine (workout sessions)';
PRINT '  - WorkoutHistory (historical records)';
PRINT '  - mesocycles (training blocks)';
PRINT '  - microcycles (weekly cycles)';
PRINT '  - ChatbotSession (chat sessions)';
PRINT '  - ChatMessages (chat history)';
PRINT '  - AIWorkoutPlans (AI workout plans)';
PRINT '  - UserUsage (usage tracking)';
PRINT '  - plans (subscription plans)';
PRINT '  - user_subscriptions (subscriptions)';
PRINT '  - subscription_transactions (audit trail)';
PRINT '  - payments (payment records)';
PRINT '  - Achievements (achievement definitions)';
PRINT '  - UserAchievements (user achievements)';
PRINT '  - OnboardingProfile (onboarding)';
PRINT '  - PreWorkoutAssessment (readiness)';
PRINT '  - DeviceData (connected devices)';
PRINT '  - OuraTokens (Oura integration)';
PRINT '  - Inquiries (user inquiries)';
PRINT '  - RewardDefinitions (rewards catalog)';
PRINT '  - UserRewards (user XP and tier)';
PRINT '  - UserRewardProgress (reward progress)';
PRINT '  - UserRewardHistory (XP history)';
PRINT '';
