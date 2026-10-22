-- Demo content so the site looks alive on first run.
-- Replace via /admin once the therapist's real details are known.
-- Apply: npm run db:seed:local  (or --remote)

INSERT INTO profile (id, json) VALUES (1, json('{
  "name": "Aina Rahman",
  "tagline": "Traditional & deep tissue massage · Petaling Jaya",
  "bio": "I have been practising massage for nine years, mostly with clients who sit at a desk all day. Sessions are slow and pressure is adjusted as we go, so you always leave looser than you arrived. Home studio, one client at a time, no rush.",
  "whatsapp": "60123456789",
  "phone": "+60 12-345 6789",
  "address": "12A, Jalan SS2/61, Petaling Jaya, Selangor",
  "map_url": "https://maps.google.com/?q=Jalan+SS2/61+Petaling+Jaya",
  "instagram": "",
  "note": "Strictly therapeutic. Appointment only.",
  "hours": [
    { "label": "Mon – Fri", "value": "10:00 – 20:00" },
    { "label": "Saturday", "value": "10:00 – 18:00" },
    { "label": "Sunday", "value": "By appointment" }
  ]
}'))
ON CONFLICT(id) DO UPDATE SET json = excluded.json;

INSERT INTO services (id, name, duration_min, price_rm, sort, active) VALUES
  ('traditional', 'Traditional Malay massage',      60,  90, 1, 1),
  ('deep-tissue', 'Deep tissue (back & shoulders)', 60, 110, 2, 1),
  ('foot',        'Foot reflexology',               45,  70, 3, 1),
  ('prenatal',    'Prenatal massage',               60, 120, 4, 1),
  ('sports',      'Sports recovery',                90, 150, 5, 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  duration_min = excluded.duration_min,
  price_rm = excluded.price_rm,
  sort = excluded.sort,
  active = 1;

-- Published reviews. Timestamps are relative to when this file is applied.
INSERT INTO reviews (id, rating, service_id, nickname, message, status, reply, replied_at, ip_hash, created_at, approved_at)
SELECT 'seed_deep_hafiz', 5, 'deep-tissue', 'Hafiz',
       'Shoulders were locked from months of sitting at a desk. Aina found the spots I did not know were sore and I could turn my head properly the next morning. Pressure was firm but she kept checking in.',
       'approved', 'Thank you Hafiz — come back before the tension builds up again!',
       now_ms - 3*day_ms + 3600000, 'seed', now_ms - 3*day_ms, now_ms - 3*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews);

INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at, approved_at)
SELECT 'seed_trad_anon', 5, 'traditional', 'Anonymous',
       'Third visit. Clean studio, no rushing, and she actually remembers which side of my back gives me trouble. The 60 minutes felt longer than that.',
       'approved', 'seed', now_ms - 9*day_ms, now_ms - 9*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_trad_anon');

INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at, approved_at)
SELECT 'seed_foot_mei', 4, 'foot', 'Mei',
       'Very good reflexology, the pressure on my arches was spot on. Only reason for four stars is the parking around SS2 is a nightmare on weekdays.',
       'approved', 'seed', now_ms - 16*day_ms, now_ms - 16*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_foot_mei');

INSERT INTO reviews (id, rating, service_id, nickname, message, status, reply, replied_at, ip_hash, created_at, approved_at)
SELECT 'seed_prenatal_sara', 5, 'prenatal', 'Saraswathi',
       'Went at 32 weeks with terrible lower back pain. She adjusted the position with pillows and checked with me constantly. Slept properly for the first time in weeks.',
       'approved', 'So glad it helped. Rest well and see you after the baby!',
       now_ms - 24*day_ms + 3600000, 'seed', now_ms - 24*day_ms, now_ms - 24*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_prenatal_sara');

INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at, approved_at)
SELECT 'seed_sports_anon', 3, 'sports', 'Anonymous',
       'Technique was good and it did help my calf, but the room was a little warm and I would have liked a firmer pressure overall. Would still return.',
       'approved', 'seed', now_ms - 33*day_ms, now_ms - 33*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_sports_anon');

INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at, approved_at)
SELECT 'seed_deep_kumar', 5, 'deep-tissue', 'Kumar',
       'I have tried a few places around PJ and this is the only one where I leave feeling genuinely worked on rather than oiled up and sent home.',
       'approved', 'seed', now_ms - 41*day_ms, now_ms - 41*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_deep_kumar');

INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at, approved_at)
SELECT 'seed_trad_nadia', 4, 'traditional', 'Nadia',
       'Easy to book over WhatsApp, replied within minutes. Massage itself was relaxing and the studio smells like a spa. Slightly hard to find the first time.',
       'approved', 'seed', now_ms - 52*day_ms, now_ms - 52*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_trad_nadia');

INSERT INTO reviews (id, rating, service_id, nickname, message, status, reply, replied_at, ip_hash, created_at, approved_at)
SELECT 'seed_foot_anon2', 2, 'foot', 'Anonymous',
       'Timing ran over by about twenty minutes and I had to leave early. The massage was fine but I was already stressed about being late.',
       'approved', 'That was my fault and I am sorry — I have since stopped taking back-to-back bookings on Saturdays.',
       now_ms - 61*day_ms + 3600000, 'seed', now_ms - 61*day_ms, now_ms - 61*day_ms
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms, 86400000 AS day_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_foot_anon2');

-- Two reviews waiting for moderation, so the queue is not empty on first login.
INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at)
SELECT 'seed_pending_1', 5, 'traditional', 'Anonymous',
       'Booked last minute for a stiff neck before a flight. She squeezed me in and I could actually sleep on the plane. Highly recommended.',
       'pending', 'seed', now_ms - 1800000
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_pending_1');

INSERT INTO reviews (id, rating, service_id, nickname, message, status, ip_hash, created_at)
SELECT 'seed_pending_2', 4, 'deep-tissue', 'Wei Ling',
       'Really good massage and very professional. Only suggestion is to add a small waiting area, I arrived early and stood outside.',
       'pending', 'seed', now_ms - 900000
FROM (SELECT CAST(strftime('%s','now') AS INTEGER) * 1000 AS now_ms)
WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE id = 'seed_pending_2');
