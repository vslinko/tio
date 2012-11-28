var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    nc = require('ncurses');


// SimpleWindow
var SimpleWindow = function () {
    EventEmitter.call(this);

    var self = this;

    this.nowPlayingWindow = new nc.Window();
    this.nowPlayingWindow.attron(nc.colorPair(1, nc.colors['GREEN'], nc.attrs['NORMAL']));
    this.nowPlayingWindow.on('inputChar', function (c, code, isKey) {
        self.emit('inputChar', c, code, isKey);
    });
    this.currentTrackMetadata = null;

    nc.showCursor = false;

    process.on('SIGWINCH', function () {
        self.resize();
    });
};

util.inherits(SimpleWindow, EventEmitter);

SimpleWindow.prototype.updateCurrentTrackMetadata = function (currentTrackMetadata) {
    this.currentTrackMetadata = currentTrackMetadata;
    this.redrawNowPlayingWindow();
};

SimpleWindow.prototype.redrawNowPlayingWindow = function () {
    if (this.currentTrackMetadata) {
        var lineNo = parseInt(this.nowPlayingWindow.height / 2 - 1);

        this.nowPlayingWindow.erase();
        this.nowPlayingWindow.centertext(lineNo, this.currentTrackMetadata.artist.join(', '));
        this.nowPlayingWindow.centertext(lineNo + 1, this.currentTrackMetadata.title);
        this.nowPlayingWindow.refresh();
    }
};

SimpleWindow.prototype.log = function () {};

SimpleWindow.prototype.resize = function () {
    this.nowPlayingWindow.resize(nc.lines, nc.cols);
    this.redrawNowPlayingWindow();
};

SimpleWindow.prototype.close = function () {
    nc.cleanup();
};


// VerboseWindow
var VerboseWindow = function () {
    SimpleWindow.call(this);

    var self = this;

    this.nowPlayingWindow.resize(parseInt(nc.lines / 2), nc.cols);

    this.logWindow = new nc.Window(nc.lines - this.nowPlayingWindow.height, nc.cols, this.nowPlayingWindow.height, 0);
    this.logWindow.attron(nc.colorPair(2, nc.colors['CYAN'] + 8, nc.attrs['NORMAL']));
    this.logWindow.on('inputChar', function (c, code, isKey) {
        self.emit('inputChar', c, code, isKey);
    });

    this.logBuffer = [];
};

util.inherits(VerboseWindow, SimpleWindow);

VerboseWindow.prototype.log = function (str) {
    if (this.logBuffer.length > this.logWindow.height) {
        this.logBuffer.shift();
    }

    this.logBuffer.push(str);
    this.redrawLogWindow();
};

VerboseWindow.prototype.redrawLogWindow = function () {
    this.logWindow.erase();

    for (var i = 0; i < this.logBuffer.length; i++) {
        this.logWindow.insstr(this.logWindow.height - i, 0, this.logBuffer[this.logBuffer.length - i - 1], nc.cols);
    }

    this.logWindow.refresh();
};

VerboseWindow.prototype.resize = function () {
    this.nowPlayingWindow.resize(parseInt(nc.lines / 2), nc.cols);

    this.logWindow.resize(nc.lines - this.nowPlayingWindow.height, nc.cols);
    this.logWindow.move(this.nowPlayingWindow.height, 0);

    this.redrawNowPlayingWindow();
    this.redrawLogWindow();
};

exports.SimpleWindow = SimpleWindow;
exports.VerboseWindow = VerboseWindow;
