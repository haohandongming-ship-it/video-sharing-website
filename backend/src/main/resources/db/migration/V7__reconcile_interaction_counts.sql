-- Counters are caches of real rows; old development seeds contained unrelated totals.
-- Anything the interaction code recomputes on write must already agree with the rows here,
-- otherwise the first click after an upgrade collapses the visible number (BUG-02).
-- The WHERE clauses keep rows that already agree untouched: the migration must not rewrite
-- (or claim to change) counters it is not actually repairing.
UPDATE videos SET like_count=(SELECT COUNT(*) FROM likes l WHERE l.target_type='VIDEO' AND l.target_id=videos.id AND l.type='LIKE'),
  dislike_count=(SELECT COUNT(*) FROM likes l WHERE l.target_type='VIDEO' AND l.target_id=videos.id AND l.type='DISLIKE'),
  favorite_count=(SELECT COUNT(*) FROM favorites f WHERE f.video_id=videos.id),
  comment_count=(SELECT COUNT(*) FROM comments c WHERE c.video_id=videos.id AND c.status='VISIBLE')
WHERE like_count<>(SELECT COUNT(*) FROM likes l WHERE l.target_type='VIDEO' AND l.target_id=videos.id AND l.type='LIKE')
   OR dislike_count<>(SELECT COUNT(*) FROM likes l WHERE l.target_type='VIDEO' AND l.target_id=videos.id AND l.type='DISLIKE')
   OR favorite_count<>(SELECT COUNT(*) FROM favorites f WHERE f.video_id=videos.id)
   OR comment_count<>(SELECT COUNT(*) FROM comments c WHERE c.video_id=videos.id AND c.status='VISIBLE');
UPDATE feeds SET like_count=(SELECT COUNT(*) FROM likes l WHERE l.target_type='FEED' AND l.target_id=feeds.id AND l.type='LIKE'),
  comment_count=(SELECT COUNT(*) FROM feed_comments fc WHERE fc.feed_id=feeds.id AND fc.status='VISIBLE')
WHERE like_count<>(SELECT COUNT(*) FROM likes l WHERE l.target_type='FEED' AND l.target_id=feeds.id AND l.type='LIKE')
   OR comment_count<>(SELECT COUNT(*) FROM feed_comments fc WHERE fc.feed_id=feeds.id AND fc.status='VISIBLE');
-- Reposts are counted from feeds rows, so the reconciliation has to read the table it updates:
-- MySQL forbids that in a subquery, hence the derived staging table (portable across H2 and MySQL).
DROP TABLE IF EXISTS repost_count_reconcile;
CREATE TABLE repost_count_reconcile AS
  SELECT repost_of_id AS feed_id, COUNT(*) AS total FROM feeds WHERE repost_of_id IS NOT NULL AND status='VISIBLE' GROUP BY repost_of_id;
UPDATE feeds SET repost_count=COALESCE((SELECT r.total FROM repost_count_reconcile r WHERE r.feed_id=feeds.id),0)
WHERE repost_count<>COALESCE((SELECT r.total FROM repost_count_reconcile r WHERE r.feed_id=feeds.id),0);
DROP TABLE repost_count_reconcile;
