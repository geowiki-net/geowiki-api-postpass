# geowiki-api-postpass
Use GeowikiAPI with a postpass backend

With [https://github.com/geowiki-net/geowiki-api Geowiki API] and this module you can query a [https://github.com/woodpeck/postpass Postpass] server with Overpass QL queries and will return OSMJSON, OSMXML or GeoJSON responses. You can even emulate an Overpass API server (although there are some limitations).

The current version does not yet support recursive queries (e.g. nodes of way: `way[...];node(w);`, relations members: `relation[...];nwr(r:"outer");`).

## LIMITATIONS of this approach
The postpass database modifies the data on import. Therefore some information gets lost and can therefore not be returned by geowiki-api-postpass.

* Meta data of map objects (timestamp, changeset, user, version)
* The 'type' tag of relations is stripped. For multipolygons this is restored, although it might also by type=boundary. You can not query for tag 'type'.
* Only multipolygon 

## INSTALLATION
### Installing Postpass server with database locally
```sh
sudo apt install git postgresql-16-postgis-3 golang-go
```

Prepare the database:
```sh
sudo -u postgres createuser -P osmuser
sudo -u postgres createdb --encoding=UTF8 --owner=osmuser osm
sudo -u postgres psql osm --command='CREATE EXTENSION postgis;'
sudo -u postgres psql osm --command='CREATE EXTENSION hstore;'
```

You could install osm2pgsql via apt, but at least version v2.3.0 is required. Otherwise compile osm2pgsql:
```sh
sudo git clone https://github.com/osm2pgsql-dev/osm2pgsql
sudo apt install make cmake g++ libboost-dev \
  libexpat1-dev zlib1g-dev libpotrace-dev \
  libopencv-dev libbz2-dev libpq-dev libproj-dev lua5.3 liblua5.3-dev \
  pandoc nlohmann-json3-dev pyosmium
cd osm2pgsql
mkdir build && cd build
cmake ..
make
sudo make install
```

Import the database file twice, once with the 'slim' mode, once with 'postpass' mode, so that all database tables are created (use the 'data.osm.bz2' file from https://github.com/geowiki-net/geowiki-api in the test folder, for running tests):
```sh
git clone https://github.com/woodpeck/postpass-ops
osm2pgsql -d postgresql://osmuser:password@localhost/osm -s data.osm.bz2
osm2pgsql -d postgresql://osmuser:password@localhost/osm -O flex -S postpass-ops/postpass.lua data.osm.bz2
psql -d postgresql://osmuser:password@localhost/osm -f postpass-ops/views.sql # ignore warnings
```

Readonly permissions for postpass server:
```sh
sudo -u postgres psql osm --command="create user readonly with password 'readonly'";
sudo -u postgres psql osm --command='grant usage on schema public to readonly;'
sudo -u postgres psql osm --command='grant select on all tables in schema public to readonly;'
sudo -u postgres psql osm --command='alter default privileges in schema public grant select on tables to readonly;'
```

Install postpass server:
```sh
git clone https://github.com/woodpeck/postpass
cd postpass
edit postpass/config.go # adapt to your configuration
make
```

Run the server:
```sh
./postpass-server
```
