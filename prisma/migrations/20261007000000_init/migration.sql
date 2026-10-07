CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL DEFAULT 'demo',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
