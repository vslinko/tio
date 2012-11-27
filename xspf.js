var EventEmitter = require('events').EventEmitter,
    XmlStream = require('xml-stream'),
    util = require('util');

var Xspf = function (stream) {
    this.xml = new XmlStream(stream);
    this.parse();
};

module.exports = Xspf;

util.inherits(Xspf, EventEmitter);

Xspf.prototype.parse = function () {
    var self = this;

    this.xml.on('endElement: track', function (track) {
        self.emit('track', track);
    });
};
