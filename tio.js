#!/usr/bin/env node
var MusicMetadata = require('musicmetadata'),
    Buffer = require('buffer').Buffer,
    spawn = require('child_process').spawn,
    https = require('https'),
    http = require('http'),
    Xspf = require('xspf'),
    util = require('util'),
    glob = require('glob'),
    ui = require('./ui');
    fs = require('fs');


// setup arguments
var optimist = require('optimist')
        .usage('Usage: $0 [arguments]')
        .alias('v', 'verbose')
        .alias('V', 'version')
        .alias('t', 'thread')
        .alias('h', 'help')
        .alias('l', 'library')
        .alias('i', 'inline')
        .alias('d', 'download')
        .default('t', 3)
        .default('l', util.format('%s/%s', process.env['HOME'], '.tio-library'))
        .string('l')
        .describe('v', 'Print more information about process')
        .describe('t', 'Threads for downloading')
        .describe('l', 'Path to your library')
        .describe('V', 'Print version information and exit')
        .describe('i', 'Use UI based on stdout, not ncurses')
        .describe('d', 'Download tracks without playing'),
    argv = optimist.argv;

if (argv.help) {
    optimist.showHelp();
    process.exit();
} else if (argv.version) {
    console.log('0.1.2');
    process.exit();
}


// preparing
var win = ui.factory(argv.download || argv.inline, argv.download || argv.verbose);
var player = null;
var library = [];
var libraryPath = argv.library;
var currentTrack = null;
var fetchSince = new Date();
var fetchUntil = new Date('2012-09-08');
var downloadQueue = [];
var currentDownloads = {};
var quitScheduled = false;


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
            win.log('Library is empty, waiting first track to be downloaded');
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
    if (!player || !player.readable) {
        player = spawn('play', [
            '--no-show-progress',
            '--volume', '.5',
            '--type', 'mp3',
            '-'
        ])
    }

    var track = library.shift();
    library.push(track);

    stop();

    currentTrack = fs.createReadStream(track, {bufferSize: 1024});
    currentTrack.pipe(player.stdin, {end: false});
    currentTrack.on('end', playNext);

    new MusicMetadata(currentTrack).on('metadata', function (metadata) {
        win.updateCurrentTrackMetadata(metadata);
    });
};

var quit = function (err) {
    quitScheduled = true;

    for (var key in currentDownloads) {
        var track = currentDownloads[key];
        win.log(util.format('Removing unfinished %s %s ', track.path, track.name));
        track.stream.destroy();
        fs.unlinkSync(track.path);
    }

    var cleanupAndExit = function () {
        win.close();
        process.exit();
    };

    if (err) {
        throw err;
    } else if (argv.verbose) {
        win.log('Wait 3 seconds until exit');
        setTimeout(cleanupAndExit, 3000);
    } else {
        cleanupAndExit();
    }
};


// processes
var fetchPlaylist = function () {
    var fetchNextPlaylist = function () {
        fetchSince.setDate(fetchSince.getDate() - 1);

        if (fetchSince >= fetchUntil && !quitScheduled) {
            fetchPlaylist();
        }
    };

    var day = fetchSince.toISOString().slice(0, 10);
    var url = util.format('http://tunes.io/xspf/%s/', day);

    var errorCallback = function () {
        win.log(util.format('Unable to fetch playlist for %s', day));
        fetchNextPlaylist();
    };

    var req = http.request(url, function (res) {
        win.log(util.format('Fetching playlist for %s', day));

        new Xspf(res).on('track', function (track) {
            track.name = util.format('%s - %s', track['creator'], track['title']);
            track.file = util.format('%s.mp3', new Buffer(track.name).toString('base64').replace(/\//g,'_'));
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
            win.log(util.format('Unable to download %s', track.name));
            fs.unlink(track.path);
            delete currentDownloads[track.path];
            downloadTrack();
        };

        win.log(util.format('Trying to download %s %s', track.name, track.location));

        var request = track.location.slice(0, 5) == 'https' ? https.request : http.request;
        var req = request(track.location, function (res) {
            if (quitScheduled) {
                return;
            }

            win.log(util.format('Downloading %s', track.name));

            track.stream = fs.createWriteStream(track.path);

            currentDownloads[track.path] = track;

            res.on('end', function () {
                delete currentDownloads[track.path];

                if (res.statusCode == 200) {
                    win.log(util.format('Downloaded %s %s', track.name, track.file));
                    library.unshift(track.path);
                    playNextIfMuted();
                } else {
                    errorCallback();
                }

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
        win.log('No work for downloader');
    }
};


// commander
win.on('command', function (command) {
    switch (command) {
        case 'n':
            playNext();
            break;
        case 's':
            stop();
            break;
        case 'p':
            playNextIfMuted();
            break;
        case 'q':
            quit();
    }
});


// initialization
if (!fs.existsSync(libraryPath)) {
    fs.mkdirSync(libraryPath);
}

if (argv.download) {
    playNext = new Function();
} else {
    syncLibrary();
}

fetchPlaylist();
for (var i = 0; i < argv.t; i++) {
    downloadTrack();
}

win.registerCommandEmitter();
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('uncaughtException', quit);
