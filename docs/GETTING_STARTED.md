# Getting Started

## Developer setup

ShieldBattery is a combination of C++, Rust and JavaScript, and split between multiple server and client
pieces. Even if you only plan on developing JavaScript changes, you'll need to install the C++
dependencies in order to properly test things.

## General environment setup

### JavaScript

All of the JavaScript will either run in, or be built by, [node.js](https://nodejs.org). You'll need
to install a version of it, generally the current version is a good choice (16.14.0 at the time of
writing). On Windows, you'll be given the option to install dependencies for building native modules
(Visual Studio build tools + Python), you should take that option if you don't already have them
installed separately.

### Yarn

The various JavaScript components use [Yarn](https://yarnpkg.com/) to manage their dependencies.
Install the latest version of it from their [downloads page](https://yarnpkg.com/en/docs/install).
Note that we are currently using "Yarn Classic" (that is, 1.x).

### C++

Visual Studio 2017 or higher is required to build various C++ parts and to link the Rust DLL.
The easiest/cheapest way to get this is through the
[Community edition](https://www.visualstudio.com/en-us/downloads/download-visual-studio-vs.aspx).

### Rust

The code that runs within BW process, as well as Electron-side process launching helpers are DLLs
written in [Rust](https://rust-lang.org). The simplest way to get things built is to use the [rustup
toolchain installer](https://rustup.rs).

Currently we launch 32-bit BW, so the game DLL needs to be built to target 32-bit Windows.
You will have to run `rustup target add i686-pc-windows-msvc` in order to have 32-bit standard
library required to build the game DLL.

To build the DLL, run `build.bat` in [`game` directory](../game), which will also copy the
resulting DLL and other necessary support files to `game/dist`, where the JavaScript code expects
them to be. The build defaults to the quicker debug build, to build the optimized version run
`build.bat release`.

If the required minimum Rust version is changed (1.63 as of this writing), you can update the Rust
toolchain by running `rustup update`.

## Server software

Along with nodejs, the server requires [PostgreSQL v9.5+](http://postgresql.org), and
[redis](http://redis.io).

There are two ways to get these dependencies:

- You can use our predefined Docker development setup. (**STRONGLY PREFERRED**)
- You can install them on your system manually.

### Using the Docker setup (recommended)

If you don't already have `docker` and `docker-compose` installed, you'll need to follow the
download/installation instructions [here](https://docs.docker.com/desktop/#download-and-install).

Once it has been installed, create a `.env` file in the root directory of this repository, if you
don't have one already (you can copy the `sample.env` file to get things going faster!). Add values
for `POSTGRES_SUPER_PASSWORD` and `SB_DB_PASSWORD` to configure your new database.

Configure the rest of your `.env` file to match what docker-compose will set up, namely:

- `DATABASE_URL=postgres://shieldbattery:[SB_DB_PASSWORD]@localhost:5433/shieldbattery`
- `SB_REDIS_HOST=localhost`
- `SB_REDIS_PORT=6380`

Then, from the root of this repository, run:

```
$ docker-compose up -d
```

If everything worked correctly, this should set up all the server dependencies, and you can run
migrations and use them with our server. Be careful about pruning volumes while these containers
aren't running, or you may accidentally remove your development data.

### Manually installing dependencies (not recommended)

If for some reason you can't use the Docker setup, or would just prefer to manage your own
servers, you can do that as well.

#### PostgreSQL

On Windows, use the installer available [here](http://www.postgresql.org/download/windows/). On
Linux, this can generally be installed through the package manager for your OS. On Mac, use
[brew](http://brew.sh).

The PostgreSQL must be started and running with a user configured (remember what the username and
password are for this account, you'll need it when configuring the ShieldBattery server).

Detailed guides can be found at
[the PostgreSQL wiki](https://wiki.postgresql.org/wiki/Detailed_installation_guides). A simpler
guide can also be found
[here](http://www.thegeekstuff.com/2009/04/linux-postgresql-install-and-configure-from-source/).

You will need some extensions set up for our schema to work properly, run the following commands
as your database super-user (generally, `postgres`):

```sql
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
```

Note that these must be run on the database you've created for ShieldBattery (e.g. you should
choose that DB first, with `\c <yourDBname>` or something similar).

#### Redis

On Windows, use the installers provided by MSOpenTech; they can be found [here](https://github.com/MSOpenTech/redis/releases). Note that only 64-bit installers are provided.
On Linux, this can generally be installed through the package manage for your OS. On Mac, use
[brew](http://brew.sh).

On Windows, redis service is started automatically if you use the above installer. on Linux/Mac, start the
redis server by using

```
redis-server
```

For more documentation, check out the [redis docs](http://redis.io/documentation).

#### Configuring the ShieldBattery server

In the root directory, copy `sample.env` to a file named `.env`. Edit this file as you see fit to
match your local configuration.

## Installing dependencies

Every directory with a `yarn.lock` needs to have its dependencies installed with Yarn. You can do
this manually, or simply run `yarnall` from the root directory:

```
yarn run yarnall
```

This should be done every time a `yarn.lock` file changes in the repository.

## Initialize the database structure

**NOTE**: PostgreSQL must be properly configured beforehand for the db-migrate scripts to work.

From the root of this repository execute this to migrate the database to the latest structure:

```
yarn run migrate-up
```

You will need to run this command after pulling in commits that change the database structure as
well.

## Set up file storage

To make sure the uploading of various files (e.g. maps, replays) is possible, ensure that the
`SB_FILE_STORE` environment variable is set correctly. Currently, files can be saved on the server's
filesystem, or on the DigitalOcean Spaces. See `sample.env` for more information on how to configure
each of those.

## Set up map system

**NOTE**: File storage must be properly configured beforehand for the map system to correctly work.

The server needs access to some of BW's data files in order to generate map images. Download an mpq
editor, such as [this one](http://www.zezula.net/en/mpq/download.html) and make sure to download
"listfiles" from that website as well, which you'll need to use in the mpq editor. Use the mpq
editor to extract BW's data files from `stardat.mpq`, `broodat.mpq`, in that order, having
`broodat.mpq` overwrite any conflicting files from `stardat.mpq`. You can obtain `stardat.mpq`
and `broodat.mpq` directly from Blizzard by downloading the final release of
[StarEdit](http://download.blizzard.com/pub/starcraft/StarEdit/StarEdit.zip).
The necessary directories in .mpq files are `unit/` and `tileset/`. Extract those files to a directory (keeping the directory
structure), and set `SB_SPRITE_DATA` in the `.env` file to that directory.

## Run the server

The standard way to run the server is (assuming you are in the project root directory):

```
yarn run start-server
```

This command will format and colorize the log output, but if you want/need the raw output you can
also use:

```
node ./server/index.js
```

### Overriding the server URL (optional)

It is possible to override the server's URL with environment variables. Two levels of environment variables:

- **Build time**: `SB_SERVER` set in the environment that runs the webpack dev server will pick the
  "default" server for that build. If none is set, the default will be, in `NODE_ENV=production`,
  `https://shieldbattery.net`, or otherwise, the canonical URL set in your local server config.
- **Run time**: `SB_SERVER` set in the environment that runs the app (`yarn run app` or just running the
  actual packaged executable).

Note: run time takes precedence over build time.

## Developer settings for SC:R

If you need to run SC:R while developing, it is possible to disable HD graphics to shorten game
launch times and to reduce system load by setting environment `SB_NO_HD` to `1`.

Disabling HD graphics may cause crashes if the game tries to render with them, so it is recommended
to launch SC:R, switch the graphics to SD, and close the game before setting the environment
variable.

## Running tests

Our tests are split into two types:

- **Unit tests**: These are written with Jest, and are next to the files they test with a
  `.test.ts` extension. They run against the specific code they test _only_, so they don't have
  e.g. a real database and any service dependencies need to be mocked.
- **Integration tests**: These are written with Playwright, and are located in the
  `integration/tests/` directory. These utilize a real server, database, etc. running in a Docker
  container. The services are recreated per global test run, but state _is_ shared between tests,
  so be careful to isolate properly (via separate user accounts, channels, etc.).

### Running unit tests locally

To run unit tests as well as lint and typechecking, do:

```sh
yarn run test
```

If you're developing a new test or modifying an existing one, you can run only the tests and re-run
on each change by doing:

```sh
yarn run testonly --watch
```

### Running integration tests locally

Since the integration service setup uses Docker, you'll need to have that installed and set up.

On Windows, run integration tests from the root of the repo by doing:

```bat
.\run-integration-tests.bat
```

This will stop any previous integration servers, create new ones, and then run the tests.

If you know that none of the changes you have made will affect the app server container
(e.g. if you only changed test code), you can also run this with `nobuild` to iterate a bit faster:

```bat
.\run-integration-tests.bat nobuild
```

On other operating systems, you can do those steps manually:

```sh
cd ./integration && \
docker-compose down -v && \
docker-compose build && \
docker-compose up -V -d && \
cd .. && \
yarn run test:integration
```
