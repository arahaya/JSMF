var JSMF = (function (window) {
    'use strict';

    // only for performance optimizations
    var is_opera = window && !!window.opera,
        is_chrome = window && !!window.chrome,
        is_firefox = window && window.navigator.userAgent.indexOf('Firefox') !== -1,

        MESSAGE_TYPE_CONNECT = 0x01,
        MESSAGE_TYPE_PING = 0x02,
        MESSAGE_TYPE_PONG = 0x03,
        MESSAGE_TYPE_INVOKE = 0x04,
        MESSAGE_TYPE_REPLY = 0x05,

        TYPE_EOF        = 0x00,
        TYPE_UNDEFINED  = 0x01,
        TYPE_NULL       = 0x02,
        TYPE_FALSE      = 0x03,
        TYPE_TRUE       = 0x04,
        TYPE_INTEGER    = 0x05,
        TYPE_NUMBER     = 0x06,
        TYPE_STRING     = 0x07,
        TYPE_DATE       = 0x08,
        TYPE_ARRAY      = 0x09,
        TYPE_OBJECT     = 0x10,

        // lookup table for charcode -> char
        _code2char = [],

        // convert byte array to byte string
        _bytes2str = is_chrome ?
            function (bytes) {
                var chr = _code2char,
                    str = '',
                    i = 0,
                    l = bytes.length;
                
                while (i < l) {
                    str += chr[bytes[i++]];
                }
                
                return str;
            } :
            function (bytes) {
                return String.fromCharCode.apply(String, bytes);
            },

        // convert byte string to byte array
        _str2bytes = function(str) {
            var bytes = [],
                i = 0,
                l = str.length;
            
            while (i < l) {
                bytes[i] = str.charCodeAt(i++);
            }
            
            return bytes;
        },

        _countUTFBytes = function (str) {
            var l = str.length,
                i = 0,
                n = 0,
                c;
            
            while (i < l) {
                c = str.charCodeAt(i++);
                
                if (c < 0x80) {
                    n += 1;
                }
                else if (c < 0x800) {
                    n += 2;
                }
                else if (c < 0xd800 || 0xdbff < c) {
                    n += 3;
                }
                else if (i < l) {
                    // UTF-16 Surrogates Pair
                    i++;// skip one char
                    n += 4;
                }
            }
            
            return n;
        },
        
        /**
         * handle 4 byte utf8 characters
         */
        _chr = function (d) {
            if (d < 0x10000) {
                return String.fromCharCode(d);
            }
            
            // convert to utf-16 format
            d -= 0x10000;
            return String.fromCharCode((d >> 10) + 0xD800) + String.fromCharCode((d & 0x3ff) + 0xDC00);
        },

        _typeof = function (obj) {
            switch (obj) {
                case undefined:
                    return TYPE_UNDEFINED;
                case null:
                    return TYPE_NULL;
                case false:
                    return TYPE_FALSE;
                case true:
                    return TYPE_TRUE;
            }
            
            switch (typeof obj) {
                case 'string':
                    return TYPE_STRING;
                case 'number':
                    if ((obj | 0) !== obj || (obj > 0xFFFFFFF) || (obj < -0x10000000)) {
                        return TYPE_NUMBER;
                    }
                    else {
                        return TYPE_INTEGER;
                    }
            }
            
            switch (Object.prototype.toString.call(obj)) {
                case '[object Date]':
                    return TYPE_DATE;
                case '[object Array]':
                case '[object Arguments]':
                    return TYPE_ARRAY;
                /*
                case '[object RegExp]':
                case '[object Error]':
                    return TYPE_STRING;
                */
                case '[object Function]':
                    return TYPE_UNDEFINED;
                default:
                    return TYPE_OBJECT;
            }
        };
    // end var
    
    // init charcode table
    (function () {
        for (var i = 0; i < 256; i++) {
            _code2char[i] = String.fromCharCode(i);
        }
    })();
    
    function BinaryWriter() {
        this._stream = [];
    };
    BinaryWriter.prototype = {
        length: function () {
            return this._stream.length;
        },
        writeByte: function (value) {
            this._stream.push(value & 0xff);
        },
        /**
         * signed 29-bit integer
         */
        writeInteger: function (value) {
            var stream = this._stream;
            
            if ((value & 0xffffff80) === 0) {
                stream.push(value & 0x7f);
            }
            else if ((value & 0xffffc000) === 0 ) {
                stream.push((value >> 7 | 0x80) & 0xff);
                stream.push(value & 0x7f);
            }
            else if ((value & 0xffe00000) === 0) {
                stream.push((value >> 14 | 0x80) & 0xff);
                stream.push((value >> 7 | 0x80) & 0xff);
                stream.push(value & 0x7f);
            }
            else {
                stream.push((value >> 22 | 0x80) & 0xff);
                stream.push((value >> 15 | 0x80) & 0xff);
                stream.push((value >> 8 | 0x80) & 0xff);
                stream.push(value & 0xff);
            }
        },
        writeDouble: function (value) {
            var stream = this._stream,
                s, m, e, c, b;
            
            if (value < 0 || (value === 0 && (1 / value) < 0)) {
                s = 128;
                value = -value;
            }
            else {
                s = 0;
            }
            
            if (isNaN(value)) {
                m = 1;
                e = 2047;
            }
            else if (value === Infinity) {
                m = 0;
                e = 2047;
            }
            else {
                e = Math.floor(Math.log(value) / Math.LN2);
                
                if (value * (c = Math.pow(2, -e)) < 1) {
                    e--;
                    c *= 2;
                }

                if (value * c >= 2) {
                    e++;
                    c /= 2;
                }

                if (e >= 1024) {
                    m = 0;
                    e = 2047;
                }
                else if (e >= -1022) {
                    m = (value * c - 1) * 0x10000000000000;
                    e += 1023;
                }
                else {
                    m = 0;
                    e = 0;
                }
            }
            
            stream.push(((e = e << 4) / 0x100 & 0xff) | s);
            stream.push((e | m / 0x1000000000000) & 0xff);
            stream.push(m / 0x10000000000 & 0xff);
            stream.push(m / 0x100000000 & 0xff);
            stream.push(m / 0x1000000 & 0xff);
            stream.push(m / 0x10000 & 0xff);
            stream.push(m / 0x100 & 0xff);
            stream.push(m & 0xff);
        },
        writeUTFBytes: function (value) {
            var stream = this._stream,
                l = value.length,
                i = 0,
                c;
            
            while (i < l) {
                c = value.charCodeAt(i++);
                
                if (c < 0x80) {
                    stream.push(c);
                }
                else if (c < 0x800) {
                    stream.push(0xc0 | (c >> 6));
                    stream.push(0x80 | (c & 0x3f));
                }
                else if (c < 0xd800 || 0xdbff < c) {
                    stream.push(0xe0 | (c >> 12));
                    stream.push(0x80 | ((c >> 6) & 0x3f));
                    stream.push(0x80 | (c & 0x3f));
                }
                else if (i < l) {
                    // UTF-16 Surrogates Pair
                    c = ((c - 0xd800) << 10) + (value.charCodeAt(i++) - 0xdc00) + 0x10000;
                    stream.push(0xf0 | (c >> 18));
                    stream.push(0x80 | ((c >> 12) & 0x3f));
                    stream.push(0x80 | ((c >> 6) & 0x3f));
                    stream.push(0x80 | (c & 0x3f));
                }
            }
        },
        toString: function () {
            return _bytes2str(this._stream);
        }
    };
    
    function BinaryReader(bstring) {
        this._stream = _str2bytes(bstring);
        this._position = 0;
    };
    BinaryReader.prototype = {
        _read: function () {
            if (this._position === this._stream.length) {
                throw new Error('BufferUnderflow');
            }
            
            return this._stream[this._position++];
        },
        seek: function (position) {
            if (position > this._stream.length) {
                throw new Error('BufferUnderflow');
            }
            
            this._position = position;
        },
        tell: function () {
            return this._position;
        },
        length: function () {
            return this._stream.length;
        },
        readByte: function () {
            var value = this._read();
            return (value & 0x80) ? -((value ^ 0xFF) + 1) : value;
        },
        readInteger: function () {
            var count = 0,
                byte = this._read(),
                value = 0;
            
            while ((byte & 0x80) !== 0 && count < 3) {
                value <<= 7;
                value |= (byte & 0x7f);
                byte = this._read();
                count++;
            }
            
            if (count < 3) {
                value <<= 7;
                value |= byte;
            }
            else {
                // Use all 8 bits from the 4th byte
                value <<= 8;
                value |= byte;

                // Check if the integer should be negative
                if ((value & 0x10000000) !== 0) {
                    //and extend the sign bit
                    value |= ~0xFFFFFFF;
                }
            }
            return value;
        },
        readDouble: function () {
            var s = this._read(),
                e = (s & 127) * 256 + this._read(),
                m = e & 15,
                value;
            
            s >>= 7;
            e >>= 4;
            
            m = m * 256 + this._read();
            m = m * 256 + this._read();
            m = m * 256 + this._read();
            m = m * 256 + this._read();
            m = m * 256 + this._read();
            m = m * 256 + this._read();
            
            if (e === 2047) {
                return m ? NaN : (s ? -Infinity : Infinity);
            }
            else if (e === 0) {
                e = -1074;
            }
            else {
                m += 0x10000000000000;
                e -= 1075;
            }
            
            value = m * Math.pow(2, e);
            return s ? -value : value;
        },
        readUTFBytes: function (length) {
            var value = '',
                chr = _chr,
                b, c;
            
            while (length-- > 0) {
                b = this._read();
                
                if (b < 0x80) {
                    c = b;
                }
                else if ((b >> 5) === 0x06) {
                    c = ((b & 0x1f) << 6) | (this._read() & 0x3f);
                    length -= 1;
                }
                else if ((b >> 4) === 0x0e) {
                    c = ((b & 0x0f) << 12) | ((this._read() & 0x3f) << 6) | (this._read() & 0x3f);
                    length -= 2;
                }
                else {
                    c = ((b & 0x07) << 18) | ((this._read() & 0x3f) << 12) | ((this._read() & 0x3f) << 6) | (this._read() & 0x3f);
                    length -= 3;
                }
                
                value += chr(c);
            }
            
            return value;
        },
        toString: function () {
            return _bytes2str(this._stream);
        }
    };
    
    function Serializer(stream) {
        this._stream = stream;
        this._reference = [];
    };
    Serializer.prototype = {
        _writeString: function (value) {
            var stream = this._stream,
                reference = this._reference,
                ref, length;
            
            // check empty
            if (!value) {
                stream.writeInteger(0x01);
                return;
            }
            
            // check reference
            ref = reference.indexOf(value);
            if (ref !== -1) {
                // write reference
                stream.writeInteger(ref << 1);
                return;
            }
            
            // count length
            length = _countUTFBytes(value);
            
            // add to reference table
            reference.push(value);
            
            // write header
            stream.writeInteger(length << 1 | 0x01);
            
            // write body
            stream.writeUTFBytes(value);
        },
        _writeArray: function (value) {
            var stream = this._stream,
                reference = this._reference,
                length = value.length,
                ref,
                index;
            
            // check empty
            if (!length) {
                stream.writeInteger(0x01);
                return;
            }
            
            // check reference
            ref = reference.indexOf(value);
            if (ref !== -1) {
                // write reference
                stream.writeInteger(ref << 1);
                return;
            }
            
            // add to reference table
            reference.push(value);
            
            // write header
            stream.writeInteger(length << 1 | 0x01);
            
            // write body
            for (index = 0; index < length; index++) {
                this.serialize(value[index]);
            }
        },
        _writeObject: function (value) {
            var stream = this._stream,
                reference = this._reference,
                ref, length, index;
            
            // count length
            length = 0;
            for (index in value) {
                if (value.hasOwnProperty(index)) {
                    length++;
                }
            }
            
            // check empty
            if (!length) {
                stream.writeInteger(0x01);
                return;
            }
            
            // check reference
            ref = reference.indexOf(value);
            if (ref !== -1) {
                // write reference
                stream.writeInteger(ref << 1);
                return;
            }
            
            // add to reference table
            reference.push(value);
            
            // write header
            stream.writeInteger(length << 1 | 0x01);
            
            // write body
            for (index in value) {
                if (value.hasOwnProperty(index)) {
                    this._writeString(index);
                    this.serialize(value[index]);
                }
            }
        },
        serialize: function(value) {
            var type = _typeof(value),
                stream = this._stream;
            
            // write type marker
            stream.writeByte(type);
            
            switch (type) {
                case TYPE_UNDEFINED:
                    break;
                case TYPE_NULL:
                    break;
                case TYPE_FALSE:
                    break;
                case TYPE_TRUE:
                    break;
                case TYPE_STRING:
                    this._writeString(value);
                    break;
                case TYPE_INTEGER:
                    // serialize signed 29-bit integer
                    stream.writeInteger(value);
                    break;
                case TYPE_NUMBER:
                    stream.writeDouble(value);
                    break;
                case TYPE_DATE:
                    stream.writeDouble(value.getTime());
                    break;
                case TYPE_ARRAY:
                    this._writeArray(value);
                    break;
                case TYPE_OBJECT:
                    this._writeObject(value);
                    break;
            }
        }
    }
    
    function Deserializer(stream) {
        this._stream = stream;
        this._reference = [];
    };
    Deserializer.prototype = {
        _readString: function () {
            var stream = this._stream,
                reference = this._reference,
                ref = stream.readInteger(),
                length, value;
            
            if (!(ref & 0x01)) {
                // reference
                ref >>= 1;
                
                if (ref >= reference.length) {
                    throw new Error();
                }
                
                return reference[ref];
            }
            
            length = ref >> 1;
            
            if (length) {
                value = stream.readUTFBytes(length);
                
                // add to reference table
                reference.push(value);
            }
            else {
                // zero length
                value = '';
            }
            
            return value;
        },
        _readArray: function () {
            var stream = this._stream,
                reference = this._reference,
                ref = stream.readInteger(),
                length, index, value;
            
            if (!(ref & 0x01)) {
                // reference
                ref >>= 1;
                
                if (ref >= reference.length) {
                    throw new Error();
                }
                
                return reference[ref];
            }
            
            length = ref >> 1;
            value = [];
            
            if (length) {
                // add to reference table
                reference.push(value);
                
                for (index = 0; index < length; index++) {
                    value.push(this.deserialize());
                }
            }
            
            return value;
        },
        _readObject: function () {
            var stream = this._stream,
                reference = this._reference,
                ref = stream.readInteger(),
                length, index, value;
            
            if (!(ref & 0x01)) {
                // reference
                ref >>= 1;
                
                if (ref >= reference.length) {
                    throw new Error();
                }
                
                return reference[ref];
            }
            
            length = ref >> 1;
            value = {};
            
            if (length) {
                // add to reference table
                reference.push(value);
                
                for (index = 0; index < length; index++) {
                    value[this._readString()] = this.deserialize();
                }
            }
            
            return value;
        },
        deserialize: function () {
            var stream = this._stream,
                index, length, temp;
            
            switch (stream.readByte()) {
                case TYPE_UNDEFINED:
                    return undefined;
                case TYPE_NULL:
                    return null;
                case TYPE_FALSE:
                    return false;
                case TYPE_TRUE:
                    return true;
                case TYPE_INTEGER:
                    return stream.readInteger();
                case TYPE_NUMBER:
                    return stream.readDouble();
                case TYPE_STRING:
                    return this._readString();
                case TYPE_DATE:
                    return new Date(stream.readDouble());
                case TYPE_ARRAY:
                    return this._readArray();
                case TYPE_OBJECT:
                    return this._readObject();
                default:
                    throw new Error('Invalid format');
            }
        }
    };
    
    function serialize(/*...rest*/) {
        var stream = new BinaryWriter(),
            serializer = new Serializer(stream),
            i = 0,
            l = arguments.length;
        
        while (i < l) {
            serializer.serialize(arguments[i++]);
        }
        
        return stream.toString();
    }
    
    function deserialize(bstring) {
        var stream = new BinaryReader(bstring),
            deserializer = new Deserializer(stream),
            length = stream.length(),
            result = [];
        
        while (1) {
            if (stream.tell() < length) {
                try {
                    result.push(deserializer.deserialize());
                }
                catch (e) {
                    break;
                }
            }
            else {
                break;
            }
        }
        
        return result;
    }
    
    function test(test) {
        // test type detection
        test('_typeof undefined', function () {
            return _typeof(undefined) === TYPE_UNDEFINED;
        });
        test('_typeof null', function () {
            return _typeof(null) === TYPE_NULL;
        });
        test('_typeof false', function () {
            return _typeof(false) === TYPE_FALSE;
        });
        test('_typeof true', function () {
            return _typeof(true) === TYPE_TRUE;
        });
        test('_typeof string', function () {
            return _typeof('hello world') === TYPE_STRING;
        });
        test('_typeof integer', function () {
            return _typeof(12345) === TYPE_INTEGER;
        });
        test('_typeof number', function () {
            return _typeof(12345.6789) === TYPE_NUMBER;
        });
        test('_typeof date', function () {
            return _typeof(new Date()) === TYPE_DATE;
        });
        test('_typeof array', function () {
            return _typeof([]) === TYPE_ARRAY;
        });
        test('_typeof arguments', function () {
            return _typeof(arguments) === TYPE_ARRAY;
        });
        test('_typeof function', function () {
            return _typeof(function () {}) === TYPE_UNDEFINED;
        });
        test('_typeof object', function () {
            return _typeof({}) === TYPE_OBJECT;
        });
        
        // test encoding/decoding
        test('writeByte positive', function () {
            var value = 123;
            var bw = new BinaryWriter();
            bw.writeByte(value);
            var br = new BinaryReader(bw.toString());
            return br.readByte() === value;
        });
        test('writeByte negative', function () {
            var value = -123;
            var bw = new BinaryWriter();
            bw.writeByte(value);
            var br = new BinaryReader(bw.toString());
            return br.readByte() === value;
        });
        test('writeInteger positive', function () {
            var value = 12345;
            var bw = new BinaryWriter();
            bw.writeInteger(value);
            var br = new BinaryReader(bw.toString());
            return br.readInteger() === value;
        });
        test('writeInteger negative', function () {
            var value = -12345;
            var bw = new BinaryWriter();
            bw.writeInteger(value);
            var br = new BinaryReader(bw.toString());
            return br.readInteger() === value;
        });
        test('writeDouble positive', function () {
            var value = 12345.6789;
            var bw = new BinaryWriter();
            bw.writeDouble(value);
            var br = new BinaryReader(bw.toString());
            return br.readDouble() === value;
        });
        test('writeDouble negative', function () {
            var value = -12345.6789;
            var bw = new BinaryWriter();
            bw.writeDouble(value);
            var br = new BinaryReader(bw.toString());
            return br.readDouble() === value;
        });
        test('writeUTFBytes latin', function () {
            var value = 'hello world';
            var bw = new BinaryWriter();
            bw.writeUTFBytes(value);
            var br = new BinaryReader(bw.toString());
            return br.readUTFBytes(bw.length()) === value;
        });
        test('writeUTFBytes japanese', function () {
            var value = 'こんにちは世界';
            var bw = new BinaryWriter();
            bw.writeUTFBytes(value);
            var br = new BinaryReader(bw.toString());
            return br.readUTFBytes(bw.length()) === value;
        });
        test('writeUTFBytes 4byte', function () {
            var value = '𠀋𠮟塡剝頰';
            var bw = new BinaryWriter();
            bw.writeUTFBytes(value);
            var br = new BinaryReader(bw.toString());
            return br.readUTFBytes(bw.length()) === value;
        });
        
        // test serialize/deserialize
        test('serialize undefined', function () {
            var value = undefined;
            var serialized = serialize(value);
            return deserialize(serialized)[0] === value;
        });
        test('serialize null', function () {
            var value = null;
            var serialized = serialize(value);
            return deserialize(serialized)[0] === value;
        });
        test('serialize false', function () {
            var value = false;
            var serialized = serialize(value);
            return deserialize(serialized)[0] === value;
        });
        test('serialize true', function () {
            var value = true;
            var serialized = serialize(value);
            return deserialize(serialized)[0] === value;
        });
        test('serialize string', function () {
            var value = 'hello world';
            var serialized = serialize(value);
            return deserialize(serialized)[0] === value;
        });
        test('serialize integer', function () {
            var value = 12345;
            var serialized = serialize(value);
            return deserialize(serialized)[0] === value;
        });
        test('serialize number', function () {
            var value = 12345.6789;
            var serialized = serialize(value);
            return deserialize(serialized)[0] === value;
        });
        test('serialize date', function () {
            var value = new Date();
            var serialized = serialize(value);
            return deserialize(serialized)[0].getTime() === value.getTime();
        });
        test('serialize array', function () {
            var value = [undefined, null, false, true, 12345, 12345.6789, 'hello world'];
            var serialized = serialize(value);
            var deserialized = deserialize(serialized)[0];
            for (var i = 0; i < value.length; i++) {
                if (value[i] !== deserialized[i]) {
                    return false;
                }
            }
            return true;
        });
        test('serialize recursive array', function () {
            var value = [];
            value[0] = value;
            var serialized = serialize(value);
            var deserialized = deserialize(serialized)[0];
            return deserialized[0] === deserialized;
        });
        test('serialize object', function () {
            var value = {
                'undefined': undefined,
                'null': null,
                'true': true,
                'false': false,
                'integer': 12345,
                'number': 12345.6789,
                'string': 'hello world'
            };
            var serialized = serialize(value);
            var deserialized = deserialize(serialized)[0];
            for (var i in value) {
                if (value.hasOwnProperty(i)) {
                    if (value[i] !== deserialized[i]) {
                        return false;
                    }
                }
            }
            return true;
        });
        test('serialize recursive object', function () {
            var value = {
                'child': {}
            };
            value.child.parent = value;
            var serialized = serialize(value);
            var deserialized = deserialize(serialized)[0];
            return deserialized.child.parent === deserialized;
        });
    }
    
    return {
        BinaryWriter: BinaryWriter,
        BinaryReader: BinaryReader,
        Serializer: Serializer,
        Deserializer: Deserializer,
        serialize: serialize,
        deserialize: deserialize,
        test: test
    };
}(window || null));