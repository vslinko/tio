var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    nc = require('ncurses');


// SimpleUI
var SimpleUI = function () {
    EventEmitter.call(this);
    this.registerCommandEmitter();
};

util.inherits(SimpleUI, EventEmitter);

SimpleUI.prototype.registerCommandEmitter = function () {
    var self = this;

    process.stdin.resume();
    process.stdin.on('data', function (data) {
        self.emit('command', data.toString().replace(/^\s+|\s+$/g, "").toLowerCase());
    });
};

SimpleUI.prototype.updateCurrentTrackMetadata = function (metadata) {
    console.log(util.format('Playing %s - %s', metadata.artist.join(', '), metadata.title))
};

SimpleUI.prototype.log = function () {};
SimpleUI.prototype.close = function () {};


// VerboseUI
var VerboseUI = function () {
    SimpleUI.call(this);
};

util.inherits(VerboseUI, SimpleUI);

VerboseUI.prototype.log = function (str) {
    console.log(str);
};


// SimpleWindowUI
var SimpleWindowUI = function () {
    EventEmitter.call(this);
    var self = this;

    this.nowPlayingWindow = new nc.Window();
    this.nowPlayingWindow.attron(nc.colorPair(1, nc.colors['GREEN'], nc.attrs['NORMAL']));
    this.currentTrackMetadata = null;
    nc.showCursor = false;
    this.registerCommandEmitter();

    process.on('SIGWINCH', function () {
        self.resize();
    });
};

util.inherits(SimpleWindowUI, SimpleUI);

SimpleWindowUI.prototype.registerCommandEmitter = function () {
    var self = this;

    this.nowPlayingWindow.on('inputChar', function (c) {
        self.emit('command', c);
    });
};

SimpleWindowUI.prototype.updateCurrentTrackMetadata = function (currentTrackMetadata) {
    this.currentTrackMetadata = currentTrackMetadata;
    this.redrawNowPlayingWindow();
};

SimpleWindowUI.prototype.redrawNowPlayingWindow = function () {
    if (this.currentTrackMetadata) {
        var lineNo = parseInt(this.nowPlayingWindow.height / 2 - 1);

        this.nowPlayingWindow.erase();
        this.nowPlayingWindow.centertext(lineNo, this.currentTrackMetadata.artist.join(', '));
        this.nowPlayingWindow.centertext(lineNo + 1, this.currentTrackMetadata.title);
        this.nowPlayingWindow.refresh();
    }
};

SimpleWindowUI.prototype.resize = function () {
    this.nowPlayingWindow.resize(nc.lines, nc.cols);
    this.redrawNowPlayingWindow();
};

SimpleWindowUI.prototype.close = function () {
    nc.cleanup();
};


// VerboseWindowUI
var VerboseWindowUI = function () {
    SimpleWindowUI.call(this);

    this.nowPlayingWindow.resize(parseInt(nc.lines / 2), nc.cols);

    this.logWindow = new nc.Window(nc.lines - this.nowPlayingWindow.height, nc.cols, this.nowPlayingWindow.height, 0);
    this.logWindow.attron(nc.colorPair(2, nc.colors['CYAN'] + 8, nc.attrs['NORMAL']));

    this.logBuffer = [];
};

util.inherits(VerboseWindowUI, SimpleWindowUI);

VerboseWindowUI.prototype.registerCommandEmitter = function () {
    this.super_.registerCommandEmitter();
    var self = this;

    this.logWindow.on('inputChar', function (c) {
        self.emit('command', c);
    });
};

VerboseWindowUI.prototype.log = function (str) {
    if (this.logBuffer.length > this.logWindow.height) {
        this.logBuffer.shift();
    }

    this.logBuffer.push(str);
    this.redrawLogWindow();
};

VerboseWindowUI.prototype.redrawLogWindow = function () {
    this.logWindow.erase();

    for (var i = 0; i < this.logBuffer.length; i++) {
        this.logWindow.insstr(this.logWindow.height - i, 0, this.logBuffer[this.logBuffer.length - i - 1], nc.cols);
    }

    this.logWindow.refresh();
};

VerboseWindowUI.prototype.resize = function () {
    this.nowPlayingWindow.resize(parseInt(nc.lines / 2), nc.cols);

    this.logWindow.resize(nc.lines - this.nowPlayingWindow.height, nc.cols);
    this.logWindow.move(this.nowPlayingWindow.height, 0);

    this.redrawNowPlayingWindow();
    this.redrawLogWindow();
};

exports.factory = function (inline, verbose) {
    if (inline) {
        return verbose ? new VerboseUI() : new SimpleUI();
    } else {
        return verbose ? new VerboseWindowUI() : new SimpleWindowUI();
    }
};
