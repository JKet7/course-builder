-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TheoryContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slideId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "width" INTEGER NOT NULL DEFAULT 100,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TheoryContent_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "TheorySlide" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TheoryContent" ("createdAt", "data", "dataVersion", "id", "order", "slideId", "type", "updatedAt") SELECT "createdAt", "data", "dataVersion", "id", "order", "slideId", "type", "updatedAt" FROM "TheoryContent";
DROP TABLE "TheoryContent";
ALTER TABLE "new_TheoryContent" RENAME TO "TheoryContent";
CREATE INDEX "TheoryContent_slideId_idx" ON "TheoryContent"("slideId");
CREATE INDEX "TheoryContent_slideId_order_idx" ON "TheoryContent"("slideId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
