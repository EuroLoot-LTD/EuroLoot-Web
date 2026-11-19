-- Additional limits apply to coupons created through the administration service.
CREATE TABLE promotion_rules (
  code TEXT PRIMARY KEY REFERENCES promotions(code),
  countries TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(countries)),
  exclusions TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(exclusions))
);
CREATE TRIGGER promotion_scope BEFORE INSERT ON orders WHEN NEW.coupon IS NOT NULL BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM promotion_rules r WHERE r.code=NEW.coupon AND
   ((json_array_length(r.countries)>0 AND NEW.country NOT IN (SELECT value FROM json_each(r.countries)))
   OR EXISTS(SELECT 1 FROM basket b JOIN json_each(r.exclusions) e ON e.value=b.product WHERE b.owner=NEW.owner)))
   THEN RAISE(ABORT,'invalid promotion') END;
END;
