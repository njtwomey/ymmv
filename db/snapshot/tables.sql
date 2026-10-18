CREATE TABLE alembic_version (
	version_num VARCHAR(32) NOT NULL, 
	CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

CREATE TABLE cars (
	id VARCHAR(64) NOT NULL, 
	label VARCHAR NOT NULL, 
	make VARCHAR NOT NULL, 
	model VARCHAR NOT NULL, 
	doors INTEGER, 
	body_type VARCHAR, 
	trims JSON NOT NULL, 
	spec JSON NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE errata (
	id INTEGER NOT NULL, 
	listing_id INTEGER NOT NULL, 
	field VARCHAR(64) NOT NULL, 
	"before" JSON, 
	"after" JSON, 
	reason VARCHAR NOT NULL, 
	evidence VARCHAR, 
	created_by VARCHAR(64) NOT NULL, 
	created_at DATETIME NOT NULL, 
	active BOOLEAN NOT NULL, 
	reverted_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(listing_id) REFERENCES listings (id)
);

CREATE TABLE "listings" (
	id INTEGER NOT NULL, 
	source VARCHAR(32) NOT NULL, 
	source_id VARCHAR(64) NOT NULL, 
	url VARCHAR, 
	title VARCHAR, 
	variant VARCHAR, 
	trim VARCHAR(32), 
	engine_l DOUBLE, 
	fuel VARCHAR(16), 
	transmission VARCHAR(16), 
	condition VARCHAR(16), 
	seller_type VARCHAR(16), 
	year INTEGER, 
	plate VARCHAR(8), 
	mileage INTEGER, 
	location VARCHAR, 
	distance_miles INTEGER, 
	price_gbp INTEGER, 
	status VARCHAR(16) NOT NULL, 
	first_seen_at DATETIME NOT NULL, 
	last_seen_at DATETIME NOT NULL, 
	delisted_at DATETIME, 
	car_id VARCHAR(64), 
	make VARCHAR, 
	model VARCHAR, 
	doors INTEGER, 
	body_type VARCHAR, 
	colour VARCHAR, 
	reserved BOOLEAN DEFAULT 0 NOT NULL, writeoff VARCHAR(8), price_indicator VARCHAR(8), 
	PRIMARY KEY (id), 
	UNIQUE (source, source_id)
);

CREATE TABLE marks (
	listing_id INTEGER NOT NULL, 
	mark VARCHAR(32) NOT NULL, 
	note VARCHAR, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (listing_id), 
	FOREIGN KEY(listing_id) REFERENCES listings (id)
);

CREATE TABLE observations (
	id INTEGER NOT NULL, 
	listing_id INTEGER NOT NULL, 
	run_id INTEGER NOT NULL, 
	observed_at DATETIME NOT NULL, 
	price_gbp INTEGER, 
	mileage INTEGER, 
	raw JSON NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (listing_id, run_id), 
	FOREIGN KEY(listing_id) REFERENCES listings (id), 
	FOREIGN KEY(run_id) REFERENCES scrape_runs (id)
);

CREATE TABLE saved_models (
	id INTEGER NOT NULL, 
	name VARCHAR NOT NULL, 
	car_id VARCHAR(64), 
	formula VARCHAR NOT NULL, 
	folds INTEGER NOT NULL, 
	standardise BOOLEAN NOT NULL, 
	filters JSON NOT NULL, 
	metrics JSON NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE scrape_runs (
	id INTEGER NOT NULL, 
	source VARCHAR(32) NOT NULL, 
	started_at DATETIME NOT NULL, 
	finished_at DATETIME, 
	complete BOOLEAN NOT NULL, 
	n_seen INTEGER NOT NULL, 
	params JSON NOT NULL, car_id VARCHAR(64), 
	PRIMARY KEY (id)
);

CREATE INDEX ix_errata_listing_id ON errata (listing_id);

CREATE INDEX ix_listings_car_id ON listings (car_id);

CREATE INDEX ix_listings_status ON listings (status);

CREATE INDEX ix_observations_listing_id ON observations (listing_id);

CREATE INDEX ix_observations_run_id ON observations (run_id);

CREATE INDEX ix_saved_models_car_id ON saved_models (car_id);

CREATE INDEX ix_scrape_runs_car_id ON scrape_runs (car_id);

CREATE INDEX ix_scrape_runs_source ON scrape_runs (source);
