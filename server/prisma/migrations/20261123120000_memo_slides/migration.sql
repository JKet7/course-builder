-- CreateTable
CREATE TABLE "MemoSlide" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MemoSlide_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MemoSlide_blockId_idx" ON "MemoSlide"("blockId");

-- CreateIndex
CREATE INDEX "MemoSlide_blockId_order_idx" ON "MemoSlide"("blockId", "order");

-- Существующие карточки каждого блока становятся одним слайдом «Слайд 1»:
-- данные не теряются, а новая структура появляется без ручного переноса.
INSERT INTO "MemoSlide" ("id", "blockId", "title", "order")
SELECT lower(hex(randomblob(16))), "blockId", 'Слайд 1', 0
FROM "MemoCell"
GROUP BY "blockId";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MemoCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MemoCell_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoCell_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "MemoSlide" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MemoCell" ("id", "blockId", "slideId", "title", "body", "order")
SELECT "MemoCell"."id", "MemoCell"."blockId", "MemoSlide"."id", "MemoCell"."title", "MemoCell"."body", "MemoCell"."order"
FROM "MemoCell"
JOIN "MemoSlide" ON "MemoSlide"."blockId" = "MemoCell"."blockId";
DROP TABLE "MemoCell";
ALTER TABLE "new_MemoCell" RENAME TO "MemoCell";
CREATE INDEX "MemoCell_blockId_idx" ON "MemoCell"("blockId");
CREATE INDEX "MemoCell_slideId_idx" ON "MemoCell"("slideId");
CREATE INDEX "MemoCell_slideId_order_idx" ON "MemoCell"("slideId", "order");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
