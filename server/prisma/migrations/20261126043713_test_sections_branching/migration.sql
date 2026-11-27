-- CreateTable
CREATE TABLE "TestSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "result" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TestSection_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestSettings" (
    "blockId" TEXT NOT NULL PRIMARY KEY,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
    "shuffleOptions" BOOLEAN NOT NULL DEFAULT false,
    "branching" BOOLEAN NOT NULL DEFAULT false,
    "result" JSONB,
    CONSTRAINT "TestSettings_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TestOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "targetType" TEXT NOT NULL DEFAULT 'next',
    "targetSectionId" TEXT,
    CONSTRAINT "TestOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "TestQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestOption_targetSectionId_fkey" FOREIGN KEY ("targetSectionId") REFERENCES "TestSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TestOption" ("id", "isCorrect", "order", "questionId", "text") SELECT "id", "isCorrect", "order", "questionId", "text" FROM "TestOption";
DROP TABLE "TestOption";
ALTER TABLE "new_TestOption" RENAME TO "TestOption";
CREATE INDEX "TestOption_questionId_idx" ON "TestOption"("questionId");
CREATE INDEX "TestOption_targetSectionId_idx" ON "TestOption"("targetSectionId");
CREATE TABLE "new_TestQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "groupId" TEXT,
    "sectionId" TEXT,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "explanation" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TestQuestion_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestQuestion_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TestGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestQuestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TestSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TestQuestion" ("blockId", "data", "explanation", "groupId", "id", "order", "type") SELECT "blockId", "data", "explanation", "groupId", "id", "order", "type" FROM "TestQuestion";
DROP TABLE "TestQuestion";
ALTER TABLE "new_TestQuestion" RENAME TO "TestQuestion";
CREATE INDEX "TestQuestion_blockId_idx" ON "TestQuestion"("blockId");
CREATE INDEX "TestQuestion_blockId_order_idx" ON "TestQuestion"("blockId", "order");
CREATE INDEX "TestQuestion_groupId_idx" ON "TestQuestion"("groupId");
CREATE INDEX "TestQuestion_sectionId_idx" ON "TestQuestion"("sectionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TestSection_blockId_idx" ON "TestSection"("blockId");

-- CreateIndex
CREATE INDEX "TestSection_blockId_order_idx" ON "TestSection"("blockId", "order");
