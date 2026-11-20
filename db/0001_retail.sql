-- D1 and SQLite use the same schema. All amounts are integer euro cents.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, country TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','developer','publisher','support','moderator','admin','sysadmin')),
  created INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE TABLE sessions (digest TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL, strong INTEGER NOT NULL DEFAULT 0);
CREATE INDEX sessions_owner ON sessions(owner);
CREATE TABLE rate_windows (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE products (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, category TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK(cents BETWEEN 0 AND 1000000),
  available INTEGER NOT NULL DEFAULT 0, fixture INTEGER NOT NULL DEFAULT 0 CHECK(fixture IN (0,1)),
  countries TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(countries))
);
CREATE TABLE basket (owner TEXT REFERENCES accounts(id), product TEXT REFERENCES products(id), PRIMARY KEY(owner,product));
CREATE TABLE wishlist (owner TEXT REFERENCES accounts(id), product TEXT REFERENCES products(id), PRIMARY KEY(owner,product));
CREATE TABLE promotions (
  code TEXT PRIMARY KEY, percent INTEGER NOT NULL CHECK(percent BETWEEN 0 AND 100),
  fixed INTEGER NOT NULL DEFAULT 0 CHECK(fixed>=0), starts INTEGER NOT NULL, ends INTEGER NOT NULL,
  max_uses INTEGER NOT NULL CHECK(max_uses>0), per_account INTEGER NOT NULL CHECK(per_account>0),
  CHECK(ends>starts AND (percent=0 OR fixed=0))
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL,
  country TEXT NOT NULL, coupon TEXT REFERENCES promotions(code), created INTEGER NOT NULL DEFAULT(unixepoch()),
  mode TEXT NOT NULL CHECK(mode IN ('local-test','stripe-test')), state TEXT NOT NULL DEFAULT 'pending'
  CHECK(state IN ('pending','complete','refunded','expired')),
  total INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, payment_ref TEXT UNIQUE,
  UNIQUE(owner,request_key)
);
CREATE INDEX orders_owner ON orders(owner,created);
CREATE TABLE lines (order_id TEXT REFERENCES orders(id), product TEXT REFERENCES products(id), title TEXT NOT NULL, cents INTEGER NOT NULL, PRIMARY KEY(order_id,product));
CREATE TABLE grants (owner TEXT REFERENCES accounts(id), product TEXT REFERENCES products(id), order_id TEXT REFERENCES orders(id), PRIMARY KEY(owner,product));
CREATE TABLE releases (
  product TEXT REFERENCES products(id), version TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes>0),
  published INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(product,version)
);
CREATE TABLE download_tokens (digest TEXT PRIMARY KEY, owner TEXT REFERENCES accounts(id), object_key TEXT REFERENCES releases(object_key), expires INTEGER NOT NULL);
CREATE TABLE tickets (id TEXT PRIMARY KEY, owner TEXT REFERENCES accounts(id), category TEXT NOT NULL,
  subject TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','in_review','closed')), created INTEGER NOT NULL DEFAULT(unixepoch()));
CREATE TABLE submissions (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id), studio TEXT NOT NULL,
  title TEXT NOT NULL, details TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'submitted' CHECK(state IN ('submitted','under_review','changes_requested','approved','rejected')), created INTEGER NOT NULL DEFAULT(unixepoch()));
CREATE TABLE audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created INTEGER NOT NULL DEFAULT(unixepoch()));
CREATE TRIGGER audit_no_edit BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER validate_basket BEFORE INSERT ON basket BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM basket WHERE owner=NEW.owner)>=30 AND NOT EXISTS(SELECT 1 FROM basket WHERE owner=NEW.owner AND product=NEW.product) THEN RAISE(ABORT,'basket limit') END;
END;

-- One statement snapshots the whole basket, validates availability and reserves a coupon.
CREATE TRIGGER validate_order BEFORE INSERT ON orders BEGIN
 SELECT CASE WHEN NEW.country<>(SELECT country FROM accounts WHERE id=NEW.owner) THEN RAISE(ABORT,'region mismatch') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM basket WHERE owner=NEW.owner) THEN RAISE(ABORT,'empty basket') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM basket b JOIN products p ON p.id=b.product WHERE b.owner=NEW.owner AND
   (p.available<>1 OR p.fixture<>1 OR (json_array_length(p.countries)>0 AND NEW.country NOT IN (SELECT value FROM json_each(p.countries)))))
   THEN RAISE(ABORT,'item unavailable') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM basket b JOIN grants g ON g.product=b.product AND g.owner=b.owner WHERE b.owner=NEW.owner)
   THEN RAISE(ABORT,'already owned') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM orders WHERE owner=NEW.owner AND state='pending') THEN RAISE(ABORT,'pending order') END;
 SELECT CASE WHEN NEW.coupon IS NOT NULL AND NOT EXISTS(SELECT 1 FROM promotions p WHERE p.code=NEW.coupon
   AND unixepoch()>=p.starts AND unixepoch()<p.ends
   AND (SELECT count(*) FROM orders o WHERE o.coupon=p.code AND o.state<>'expired')<p.max_uses
   AND (SELECT count(*) FROM orders o WHERE o.coupon=p.code AND o.owner=NEW.owner AND o.state<>'expired')<p.per_account)
   THEN RAISE(ABORT,'invalid promotion') END;
END;
CREATE TRIGGER snapshot_order AFTER INSERT ON orders BEGIN
 INSERT INTO lines SELECT NEW.id,p.id,p.title,p.cents FROM basket b JOIN products p ON p.id=b.product WHERE b.owner=NEW.owner;
 UPDATE orders SET total=(SELECT sum(cents) FROM lines WHERE order_id=NEW.id) WHERE id=NEW.id;
 UPDATE orders SET discount=coalesce((SELECT min(total, fixed + total*percent/100) FROM promotions WHERE code=NEW.coupon),0) WHERE id=NEW.id;
 UPDATE orders SET total=total-discount WHERE id=NEW.id;
END;
CREATE TRIGGER validate_transition BEFORE UPDATE OF state ON orders WHEN NEW.state<>OLD.state BEGIN
 SELECT CASE WHEN NOT ((OLD.state='pending' AND NEW.state IN ('complete','expired')) OR (OLD.state='complete' AND NEW.state='refunded'))
 THEN RAISE(ABORT,'invalid transition') END;
END;
CREATE TRIGGER fulfill_order AFTER UPDATE OF state ON orders WHEN OLD.state='pending' AND NEW.state='complete' BEGIN
 INSERT INTO grants SELECT NEW.owner,product,NEW.id FROM lines WHERE order_id=NEW.id;
 DELETE FROM basket WHERE owner=NEW.owner AND product IN (SELECT product FROM lines WHERE order_id=NEW.id);
 INSERT INTO audit(actor,action,target) VALUES(NEW.owner,'order.completed',NEW.id);
END;
CREATE TRIGGER refund_order AFTER UPDATE OF state ON orders WHEN OLD.state='complete' AND NEW.state='refunded' BEGIN
 DELETE FROM grants WHERE order_id=NEW.id;
 INSERT INTO audit(actor,action,target) VALUES('system','order.refunded',NEW.id);
END;
CREATE INDEX audit_time ON audit(created);
CREATE INDEX download_expiry ON download_tokens(expires);
CREATE TABLE invitations (digest TEXT PRIMARY KEY, owner TEXT REFERENCES accounts(id), expires INTEGER NOT NULL, strong INTEGER NOT NULL DEFAULT 0);
