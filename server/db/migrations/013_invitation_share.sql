ALTER TABLE invitations ADD COLUMN assigned_share text CHECK (assigned_share ~ '^[0-9]+$' AND assigned_share::numeric > 0);
