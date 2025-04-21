-- Script setup untuk database Supabase RAG Chatbot
-- Jalankan script ini di SQL Editor Supabase

-- PENTING: Sesuaikan memory untuk operasi maintenance sebelum membuat index
SET maintenance_work_mem = '128MB';  -- Increasing from 32MB to 128MB

-- PENTING: Install pgvector extension terlebih dahulu
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabel conversations untuk menyimpan percakapan
CREATE TABLE IF NOT EXISTS public.conversations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text DEFAULT 'New Conversation',
    document_context jsonb DEFAULT '[]',  -- Added from alter_conversations_table.sql
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Update any existing rows that might have NULL values for document_context
UPDATE public.conversations SET document_context = '[]' WHERE document_context IS NULL;

-- RLS (Row Level Security) untuk tabel conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Policy untuk membatasi akses ke percakapan hanya oleh pemiliknya
-- Hapus policy lama jika ada sebelum membuat yang baru (opsional, tapi aman)
DROP POLICY IF EXISTS "Pengguna dapat CRUD percakapan mereka sendiri" ON public.conversations;
CREATE POLICY "Pengguna dapat CRUD percakapan mereka sendiri"
    ON public.conversations
    FOR ALL -- More explicit policy
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id); -- Added WITH CHECK for INSERT/UPDATE

-- Tabel messages untuk menyimpan pesan dalam percakapan
CREATE TABLE IF NOT EXISTS public.messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'thinking')), -- Added CHECK constraint
    content text NOT NULL,
    metadata jsonb,
    created_at timestamptz DEFAULT now()
);

-- RLS untuk tabel messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Policy untuk membatasi akses ke pesan hanya oleh pemiliknya
-- Hapus policy lama jika ada sebelum membuat yang baru (opsional, tapi aman)
DROP POLICY IF EXISTS "Pengguna dapat CRUD pesan mereka sendiri" ON public.messages;
CREATE POLICY "Pengguna dapat CRUD pesan mereka sendiri"
    ON public.messages
    FOR ALL -- More explicit policy
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id); -- Added WITH CHECK for INSERT/UPDATE

-- NEW: Tabel untuk menyimpan dokumen yang diunggah
CREATE TABLE IF NOT EXISTS public.documents (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}',
    is_public boolean DEFAULT false,
    is_shared boolean DEFAULT false,
    shared_with jsonb DEFAULT '[]',
    file_size integer,
    page_count integer,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_accessed_at timestamptz DEFAULT now()
);

-- RLS untuk tabel documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Policy untuk dokumen - pemilik memiliki akses penuh
DROP POLICY IF EXISTS "Pemilik dapat CRUD dokumen mereka sendiri" ON public.documents;
CREATE POLICY "Pemilik dapat CRUD dokumen mereka sendiri"
    ON public.documents
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy untuk dokumen publik - semua dapat membaca
DROP POLICY IF EXISTS "Dokumen publik dapat dibaca oleh semua" ON public.documents;
CREATE POLICY "Dokumen publik dapat dibaca oleh semua"
    ON public.documents
    FOR SELECT
    USING (is_public = true);

-- Policy untuk dokumen dibagi - pengguna tertentu dapat membaca
DROP POLICY IF EXISTS "Dokumen dibagi dapat dibaca oleh pengguna tertentu" ON public.documents;
CREATE POLICY "Dokumen dibagi dapat dibaca oleh pengguna tertentu"
    ON public.documents
    FOR SELECT
    USING (is_shared = true AND (auth.uid())::text IN (SELECT jsonb_array_elements_text(shared_with)));

-- NEW: Tabel untuk menyimpan chunk dokumen untuk RAG
CREATE TABLE IF NOT EXISTS public.document_chunks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}',
    embedding vector(1536), -- Changed back to 1536 to match Gemini embedding dimensions
    created_at timestamptz DEFAULT now(),
    UNIQUE(document_id, chunk_index) -- Added unique constraint to prevent 409 conflicts
);

-- Index untuk embedding similarity search (untuk pgvector)
DROP INDEX IF EXISTS document_chunks_embedding_idx;

-- CREATE index after setting maintenance_work_mem
CREATE INDEX document_chunks_embedding_idx ON public.document_chunks USING ivfflat (embedding vector_l2_ops)
WITH (lists = 100);

-- RLS untuk tabel document_chunks
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- Policy untuk document_chunks - pengguna pemilik dapat CRUD
DROP POLICY IF EXISTS "Pemilik dapat CRUD chunk dokumen mereka sendiri" ON public.document_chunks;
CREATE POLICY "Pemilik dapat CRUD chunk dokumen mereka sendiri"
    ON public.document_chunks
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy untuk document_chunks publik - semua dapat melihat
DROP POLICY IF EXISTS "Chunk dokumen publik dapat dibaca oleh semua" ON public.document_chunks;
CREATE POLICY "Chunk dokumen publik dapat dibaca oleh semua"
    ON public.document_chunks
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.id = document_id AND d.is_public = true
    ));

-- Policy untuk document_chunks dibagi - pengguna tertentu dapat melihat
DROP POLICY IF EXISTS "Chunk dokumen dibagi dapat dibaca oleh pengguna tertentu" ON public.document_chunks;
CREATE POLICY "Chunk dokumen dibagi dapat dibaca oleh pengguna tertentu"
    ON public.document_chunks
    FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.id = document_id 
        AND d.is_shared = true 
        AND (auth.uid())::text IN (SELECT jsonb_array_elements_text(d.shared_with))
    ));

-- NEW: Tabel untuk menyimpan RAG sessions
CREATE TABLE IF NOT EXISTS public.rag_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_ids jsonb DEFAULT '[]',
    conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
    config jsonb DEFAULT '{}',
    status text DEFAULT 'active',
    model_version text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_accessed_at timestamptz DEFAULT now()
);

-- RLS untuk tabel rag_sessions
ALTER TABLE public.rag_sessions ENABLE ROW LEVEL SECURITY;

-- Policy untuk rag_sessions
DROP POLICY IF EXISTS "Pengguna dapat CRUD rag_sessions mereka sendiri" ON public.rag_sessions;
CREATE POLICY "Pengguna dapat CRUD rag_sessions mereka sendiri"
    ON public.rag_sessions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Membuat indeks untuk optimasi query
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id); 
CREATE INDEX IF NOT EXISTS idx_conversations_document_context ON public.conversations USING GIN (document_context); -- Added from alter_conversations_table.sql
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id); 
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON public.document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_rag_sessions_user_id ON public.rag_sessions(user_id);

-- Pastikan view dibuat setelah tabel dan indeks
-- (Jalankan bagian CREATE VIEW ini secara terpisah jika editor SQL Anda memerlukannya)
CREATE OR REPLACE VIEW public.messages_with_conversations AS -- Added OR REPLACE
    SELECT m.*, c.title as conversation_title
    FROM public.messages m
    JOIN public.conversations c ON m.conversation_id = c.id;

-- Berikan akses SELECT pada view ke pengguna yang terautentikasi
GRANT SELECT ON public.messages_with_conversations TO authenticated;

-- Grant permissions to conversations table (added from alter_conversations_table.sql)
GRANT ALL ON public.conversations TO authenticated;

-- Function untuk membersihkan dokumen yang tidak diakses dalam waktu tertentu (30 hari)
CREATE OR REPLACE FUNCTION cleanup_old_documents()
RETURNS void AS $$
BEGIN
    DELETE FROM public.documents
    WHERE last_accessed_at < NOW() - INTERVAL '30 days'
    AND is_public = false
    AND is_shared = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function untuk update last_accessed_at saat dokumen diakses
CREATE OR REPLACE FUNCTION update_document_access_time()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.documents
    SET last_accessed_at = NOW()
    WHERE id = NEW.document_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger untuk update last_accessed_at
DROP TRIGGER IF EXISTS update_document_access_time_trigger ON public.document_chunks;
CREATE TRIGGER update_document_access_time_trigger
AFTER INSERT OR UPDATE ON public.document_chunks
FOR EACH ROW EXECUTE FUNCTION update_document_access_time();

-- Reset maintenance_work_mem to default if needed (optional)
-- SET maintenance_work_mem TO DEFAULT;

-- CATATAN: Jika masih mendapat error memori, mungkin perlu split script ini menjadi beberapa bagian
-- atau jalankan melalui SQL console langsung di Supabase dan bukan melalui API client