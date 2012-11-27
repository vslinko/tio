#!/usr/bin/env node
var MusicMetadata = require('musicmetadata'),
    Buffer = require('buffer').Buffer,
    spawn = require('child_process').spawn,
    https = require('https'),
    http = require('http'),
    Xspf = require('./xspf'),
    util = require('util'),
    glob = require('glob'),
    clc = require('cli-color'),
    fs = require('fs');
var dummy = function () {};

// setup arguments
var optimist = require('optimist')
        .usage('Usage: $0 [arguments]')
        .alias('v', 'verbose')
        .alias('t', 'thread')
        .alias('h', 'help')
        .default('t', 3)
        .describe('v', 'Print more information about process')
        .describe('t', 'Threads for downloading'),
    argv = optimist.argv,
    verbose = argv.verbose ? console.log : dummy;

if (argv.help) {
    optimist.showHelp();
    process.exit();
}


// preparing
var player = spawn('play', [
    '--no-show-progress',
    '--volume', '.5',
    '--type', 'mp3',
    '-'
]);
var library = [];
var libraryPath = __dirname + '/library';
var currentTrack = null;
var fetchSince = new Date();
var fetchUntil = new Date('2012-09-08');
var downloadQueue = [];
var currentDownloads = {};


// actions
var syncLibrary = function () {
    glob(libraryPath + '/*.mp3', function (err, matches) {
        if (matches.length > 0) {
            matches.sort(function () {
                return 0.5 - Math.random();
            });

            library = matches;

            playNextIfMuted();
        } else {
            console.log(clc.magenta('Library is empty, waiting first track to be downloaded'));
        }
    });
};

var playNextIfMuted = function () {
    if (!currentTrack || !currentTrack.readable) {
        playNext();
    }
};

var stop = function () {
    if (currentTrack) {
        currentTrack.destroy();
    }
};

var playNext = function () {
    var track = library.shift();
    library.push(track);

    stop();

    currentTrack = fs.createReadStream(track, {bufferSize: 1024});
    currentTrack.pipe(player.stdin, {end: false});
    currentTrack.on('end', playNext);

    new MusicMetadata(currentTrack).on('metadata', function (metadata) {
        if (metadata.title) {
            if (metadata.artist.length > 0) {
                console.log(util.format('Playing %s', clc.green(metadata.artist + " - " + metadata.title)));
            } else {
                console.log(util.format('Playing %s', clc.green(metadata.title)));
            }
        } else {
            console.log("Playing next track");
        }
    });
};

var quit = function () {
    process.stdout.write("\n");

    fetchPlaylist = dummy;
    downloadTrack = dummy;

    for (var key in currentDownloads) {
        var track = currentDownloads[key];
        verbose(util.format('Removing unfinished %s %s ', clc.green(track.path), clc.magenta(track.name)));
        track.stream.destroy();
        fs.unlinkSync(track.path);
    }

    process.exit(0);
};


// processes
var fetchPlaylist = function () {
    var fetchNextPlaylist = function () {
        fetchSince.setDate(fetchSince.getDate() - 1);

        if (fetchSince >= fetchUntil) {
            fetchPlaylist();
        }
    };

    var day = fetchSince.toISOString().slice(0, 10);
    var url = util.format('http://tunes.io/xspf/%s/', day);

    var errorCallback = function () {
        verbose(clc.red(util.format('Unable to fetch playlist for %s', day)));
        fetchNextPlaylist();
    };

    var req = http.request(url, function (res) {
        verbose(util.format('Fetching playlist for %s', clc.green(day)));

        new Xspf(res).on('track', function (track) {
            track.name = util.format('%s - %s', track['creator'], track['title']);
            track.file = util.format('%s.mp3', new Buffer(track.name).toString('base64'));
            track.path = util.format('%s/%s', libraryPath, track.file);

            if (!fs.existsSync(track.path)) {
                downloadQueue.push(track);
            }
        });

        res.on('end', fetchNextPlaylist);
        res.on('error', errorCallback);
    });

    req.on('error', errorCallback);
    req.end();
};

var downloadTrack = function () {
    if (downloadQueue.length > 0) {
        var track = downloadQueue.shift();

        var errorCallback = function () {
            verbose(clc.red(util.format('Unable to download %s', track.name)));
            fs.unlink(track.path);
            delete currentDownloads[track.path];
            downloadTrack();
        };

        verbose(util.format('Trying to download %s %s', clc.green(track.name), clc.magenta(track.location)));

        var request = track.location.slice(0, 5) == 'https' ? https.request : http.request;
        var req = request(track.location, function (res) {
            verbose(util.format('Downloading %s', clc.green(track.name)));

            track.stream = fs.createWriteStream(track.path);

            currentDownloads[track.path] = track;

            res.on('end', function () {
                delete currentDownloads[track.path];

                if (res.statusCode == 200) {
                    verbose(util.format('Downloaded %s %s', clc.green(track.name), clc.magenta(track.file)));
                    library.unshift(track.path);
                } else {
                    errorCallback();
                }

                playNextIfMuted();
                downloadTrack();
            });

            res.on('error', errorCallback);
            res.pipe(track.stream);
        });

        req.on('error', errorCallback);
        req.end();
    } else if (fetchSince >= fetchUntil) {
        setTimeout(downloadTrack, 1000);
    } else {
        verbose(clc.magenta('No work for downloader'));
    }
};

var commander = function (data) {
    var command = data.toString().replace(/^\s+|\s+$/g, "").toLowerCase();

    switch (command) {
        case 'next': case 'n':
            playNext();
            break;
        case 'stop': case 's':
            stop();
            break;
        case 'play': case 'p':
            playNextIfMuted();
            break;
        case 'exit': case 'quit': case 'q':
            quit();
    }
};


// initialization
if (!fs.existsSync(libraryPath)) {
    fs.mkdirSync(libraryPath);
}

syncLibrary();
fetchPlaylist();
for (var i = 0; i < argv.t; i++) {
    downloadTrack();
}

process.stdin.resume();
process.stdin.on('data', commander);
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
