REVOKE SELECT ON public.waitlist_signups FROM anon, authenticated;
CREATE POLICY "No client reads of waitlist" ON public.waitlist_signups FOR SELECT USING (false);
CREATE POLICY "No client updates of waitlist" ON public.waitlist_signups FOR UPDATE USING (false);
CREATE POLICY "No client deletes of waitlist" ON public.waitlist_signups FOR DELETE USING (false);