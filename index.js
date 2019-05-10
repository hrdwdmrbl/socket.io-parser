/**
 * Module dependencies.
 */

const debug = require('debug')('socket.io-parser');
const Emitter = require('component-emitter');
const isArray = require('isarray');
const yieldableJSON = require('yieldable-json');

/**
 * Protocol version.
 *
 * @api public
 */

exports.protocol = 5;

/**
 * Packet types.
 *
 * @api public
 */

exports.types = [
  'CONNECT', // 0
  'DISCONNECT', // 1
  'EVENT', // 2
  'ACK', // 3
  'ERROR' // 4
];

/**
 * Packet type `connect`.
 *
 * @api public
 */

exports.CONNECT = 0;

/**
 * Packet type `disconnect`.
 *
 * @api public
 */

exports.DISCONNECT = 1;

/**
 * Packet type `event`.
 *
 * @api public
 */

exports.EVENT = 2;

/**
 * Packet type `ack`.
 *
 * @api public
 */

exports.ACK = 3;

/**
 * Packet type `error`.
 *
 * @api public
 */

exports.ERROR = 4;

/**
 * @typedef Packet
 * @property {string} type One of the 5 types identified above
 * @property {string=} nsp Namespace
 * @property {string=} id Each packet has a unique ID if the server wishes receipt to be acknowledged
 * @property {object=} data
 */

/**
 * A socket.io Encoder instance
 *
 * @api public
 */
class Encoder {
  /**
   * Encode a packet as a single string if non-binary, or as a
   * buffer sequence, depending on packet type.
   *
   * @param {Packet} packet - packet object
   * @param {Function} callback - function to handle encodings (likely engine.write)
   * @return Calls callback with Array of encodings
   * @api public
   */
  encode(packet, callback) {
    debug('encoding packet %j', packet);

    const encodedPacketPromise = this._encodePacket(packet);
    encodedPacketPromise.then(encodedPacket => {
      callback([encodedPacket]);
    });
  }

  /**
   * @private
   * @param {Packet} packet
   */
  async _encodePacket(packet) {
    // first is type
    let encodedPacket = '' + packet.type;

    // if we have a namespace other than `/`
    // we append it followed by a comma `,`
    if (packet.nsp && '/' !== packet.nsp) {
      encodedPacket += packet.nsp + ',';
    }

    // immediately followed by the id
    if (null != packet.id) {
      encodedPacket += packet.id;
    }

    // json data
    if (null != packet.data) {
      const payload = this._tryStringify(packet.data);
      if (payload !== false) {
        encodedPacket += payload;
      } else {
        return ERROR_PACKET;
      }
    }

    debug('encoded %j as %s', packet, encodedPacket);
    return encodedPacket;
  }

  /**
   * @private
   * @param {Object} object
   * @return {string|false}
   */
  _tryStringify(object) {
    try {
      return JSON.stringify(object);
    } catch (e) {
      return false;
    }
  }

}

const ERROR_PACKET = exports.ERROR + '"encode error"';

/**
 * A socket.io Decoder instance
 *
 * @api public
 */
class Decoder extends Emitter {
  /**
   * Decodes an encoded packet string into packet JSON.
   *
   * @param {String} encodedPacket
   */
  add(encodedPacket) {
    if (typeof encodedPacket === 'string') {
      const packetPromise = this._decodePacket(encodedPacket);
      packetPromise.then(packet => {
        this.emit('decoded', packet);
      })
    } else {
      throw new Error('Unknown type: ' + encodedPacket);
    }
  }
  /**
   * Decode a packet String (JSON data)
   *
   * @param {String} encodedPacket
   * @return {Promise}
   * @private
   */
  async _decodePacket(encodedPacket) {
    let i = 0;
    // look up type
    const packet = {
      type: Number(encodedPacket.charAt(0))
    };

    if (null == exports.types[packet.type]) {
      return buildError('unknown packet type ' + packet.type);
    }

    // look up namespace (if any)
    if ('/' === encodedPacket.charAt(1)) {
      packet.nsp = '';
      while (++i) {
        const c = encodedPacket.charAt(i);
        // There should be a "," separating the namespace from the rest of the packet.
        // If we reach the "," then the namespace is complete
        if (',' === c) break;
        packet.nsp += c;
        if (i === encodedPacket.length) break;
      }
    } else {
      packet.nsp = '/';
    }

    // look up id (if any)
    const next = encodedPacket.charAt(i + 1);
    if ('' !== next && Number(next) == next) {
      packet.id = '';
      while (++i) {
        const c = encodedPacket.charAt(i);
        // Keep going until we run out of characters or the character is no longer a Number
        if (null == c || Number(c) != c) {
          --i;
          break;
        }
        packet.id += c;
        if (i === encodedPacket.length) break;
      }
      packet.id = Number(packet.id);
    }

    // look up json data
    if (encodedPacket.charAt(++i)) {
      const payload = await this._tryParse(encodedPacket.substr(i));
      const isPayloadValid = payload !== false && (packet.type === exports.ERROR || isArray(payload));
      if (isPayloadValid) {
        packet.data = payload;
      } else {
        return buildError('invalid payload');
      }
    }

    debug('decoded %s as %j', encodedPacket, packet);
    return packet;
  }

  /**
   * @private
   * @param {string} encodedData
   * @return {Object|false}
   */
  _tryParse(encodedData) {
    return new Promise(resolve => {
      yieldableJSON.parseAsync(encodedData, (error, parsedJSON) => {
        if (error) {
          resolve(false);
        } else {
          resolve(parsedJSON);
        }
      });
    });
  }

  /**
   * Deallocates a parser's resources
   *
   * @api public
   */

  destroy() {}
}

function buildError(msg) {
  return {
    type: exports.ERROR,
    data: 'parser error: ' + msg
  };
}

/**
 * Encoder constructor.
 *
 * @api public
 */

exports.Encoder = Encoder;

/**
 * Decoder constructor.
 *
 * @api public
 */

exports.Decoder = Decoder;
