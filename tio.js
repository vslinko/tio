#!/usr/bin/env node
var MusicMetadata = require('musicmetadata'),
    Buffer = require('buffer').Buffer,
    spawn = require('child_process').spawn,
    https = require('https'),
    http = require('http'),
    Xspf = require('./xspf'),
    util = require('util'),
    glob = require('glob'),
    nc = require('ncurses'),
    fs = require('fs');


// setup arguments
var optimist = require('optimist')
        .usage('Usage: $0 [arguments]')
        .alias('v', 'verbose')
        .alias('V', 'version')
        .alias('t', 'thread')
        .alias('h', 'help')
        .alias('l', 'library')
        .default('t', 3)
        .default('l', util.format('%s/%s', process.env['HOME'], '.tio-library'))
        .string('l')
        .describe('v', 'Print more information about process')
        .describe('t', 'Threads for downloading')
        .describe('l', 'Path to your library')
        .describe('V', 'Print version information and exit'),
    argv = optimist.argv;

if (argv.help) {
    optimist.showHelp();
    process.exit();
} else if (argv.version) {
    console.log('0.0.4');
    process.exit();
}


// commander
var commander = function (command) {
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
};


// ncurses
var nowPlayingWindow = new nc.Window();

var greenColor = nc.colorPair(1, nc.colors['GREEN'], nc.attrs['NORMAL']),
    cyanColor = nc.colorPair(2, nc.colors['CYAN'] + 8, nc.attrs['NORMAL']);

nowPlayingWindow.attron(greenColor);
nc.showCursor = false;

var log;
if (argv.verbose) {
    nowPlayingWindow.resize(nc.lines / 2, nc.cols);

    var logWindow = new nc.Window(nc.lines - nowPlayingWindow.height, nc.cols, nowPlayingWindow.height, 0);
    logWindow.attron(cyanColor);

    var logBuffer = [];

    log = function (str) {
        if (logBuffer.length > logWindow.height) {
            logBuffer.shift();
        }

        logBuffer.push(str);
    };

    var redrawLogWindow = function () {
        logWindow.erase();

        for (var i = 0; i < logBuffer.length; i++) {
            logWindow.insstr(logWindow.height - i, 0, logBuffer[logBuffer.length - i - 1], nc.cols);
        }

        logWindow.refresh();
    };

    logWindow.on('inputChar', commander);
} else {
    log = new Function();
    nowPlayingWindow.on('inputChar', commander);
}

var redrawNowPlayingWindow = function () {
    var lineNo = parseInt(nowPlayingWindow.height / 2 - 1);

    nowPlayingWindow.erase();
    nowPlayingWindow.centertext(lineNo, currentTrackMetadata.artist.join(', '));
    nowPlayingWindow.centertext(lineNo + 1, currentTrackMetadata.title);
    nowPlayingWindow.refresh();
};


// preparing
var player = spawn('play', [
    '--no-show-progress',
    '--volume', '.5',
    '--type', 'mp3',
    '-'
]);
var library = [];
var libraryPath = argv.library;
var currentTrack = null;
var currentTrackMetadata = null;
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
            log('Library is empty, waiting first track to be downloaded');
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
        currentTrackMetadata = metadata;
        redrawNowPlayingWindow();
    });
};

var quit = function (err) {
    quitScheduled = true;

    for (var key in currentDownloads) {
        var track = currentDownloads[key];
        log(util.format('Removing unfinished %s %s ', track.path, track.name));
        track.stream.destroy();
        fs.unlinkSync(track.path);
    }

    var cleanupAndExit = function () {
        nc.cleanup();

        if (err) {
            throw err;
        } else {
            process.exit();
        }
    };

    if (argv.verbose) {
        log('Wait 3 seconds until exit');
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
        log(util.format('Unable to fetch playlist for %s', day));
        fetchNextPlaylist();
    };

    var req = http.request(url, function (res) {
        log(util.format('Fetching playlist for %s', day));

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
            log(util.format('Unable to download %s', track.name));
            fs.unlink(track.path);
            delete currentDownloads[track.path];
            downloadTrack();
        };

        log(util.format('Trying to download %s %s', track.name, track.location));

        var request = track.location.slice(0, 5) == 'https' ? https.request : http.request;
        var req = request(track.location, function (res) {
            if (quitScheduled) {
                return;
            }

            log(util.format('Downloading %s', track.name));

            track.stream = fs.createWriteStream(track.path);

            currentDownloads[track.path] = track;

            res.on('end', function () {
                delete currentDownloads[track.path];

                if (res.statusCode == 200) {
                    log(util.format('Downloaded %s %s', track.name, track.file));
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
        log('No work for downloader');
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

process.on('SIGWINCH', function () {
    if (argv.verbose) {
        nowPlayingWindow.resize(nc.lines / 2, nc.cols);
        logWindow.resize(nc.lines - nowPlayingWindow.height, nc.cols);
        logWindow.move(nowPlayingWindow.height, 0);
        redrawNowPlayingWindow();
        redrawLogWindow();
    } else {
        nowPlayingWindow.resize(nc.lines, nc.cols);
        redrawNowPlayingWindow();
    }
});
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('uncaughtException', quit);
