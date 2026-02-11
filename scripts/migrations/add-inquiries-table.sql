-- Create Inquiries table for persisting user inquiry history
-- Safe to re-run: uses IF NOT EXISTS check

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.Inquiries') AND type = 'U')
BEGIN
  CREATE TABLE dbo.Inquiries (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    UserId INT NOT NULL,
    Topic NVARCHAR(50) NOT NULL DEFAULT 'general',
    Subject NVARCHAR(255) NOT NULL DEFAULT 'FitNxt Customer Inquiry',
    Message NVARCHAR(MAX) NOT NULL,
    AttachmentCount INT NOT NULL DEFAULT 0,
    Status NVARCHAR(20) NOT NULL DEFAULT 'sent',
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_Inquiries_UserProfile FOREIGN KEY (UserId) REFERENCES dbo.UserProfile(UserID)
  );
  CREATE INDEX IX_Inquiries_UserId_CreatedAt ON dbo.Inquiries(UserId, CreatedAt DESC);
  PRINT 'Created dbo.Inquiries table';
END
ELSE
BEGIN
  PRINT 'dbo.Inquiries table already exists — skipping';
END
GO
