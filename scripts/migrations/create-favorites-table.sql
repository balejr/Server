-- Create Favorites table for storing user exercise favorites
-- Safe to re-run: uses IF NOT EXISTS check

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.Favorites') AND type = 'U')
BEGIN
  CREATE TABLE dbo.Favorites (
    FavoriteID INT IDENTITY(1,1) PRIMARY KEY,
    UserID INT NOT NULL FOREIGN KEY REFERENCES dbo.UserProfile(UserID),
    ExerciseID NVARCHAR(255) NOT NULL,
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT UQ_Favorites_User_Exercise UNIQUE (UserID, ExerciseID)
  );
  PRINT 'Created dbo.Favorites table';
END
ELSE
BEGIN
  PRINT 'dbo.Favorites table already exists — skipping';
END
GO
