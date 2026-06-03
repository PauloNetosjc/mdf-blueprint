CREATE POLICY "pc_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pecas-cadastradas' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "pc_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pecas-cadastradas' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "pc_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pecas-cadastradas' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "pc_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pecas-cadastradas' AND auth.uid()::text = (storage.foldername(name))[1]);