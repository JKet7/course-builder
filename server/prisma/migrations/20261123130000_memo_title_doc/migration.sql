-- Форматированный заголовок карточки памятки (Tiptap JSON).
-- Старые карточки остаются с titleDoc = NULL: клиент рисует их title как раньше.
ALTER TABLE "MemoCell" ADD COLUMN "titleDoc" JSONB;
