working...

### Format
    <document>  ::= *<element>

    <element>   ::= "\x01"          <!-- undefined -->
                  | "\x02"          <!-- null -->
                  | "\x03"          <!-- false -->
                  | "\x04"          <!-- true -->
                  | "\x05" <int29>  <!-- integer -->
                  | "\x06" <double> <!-- number -->
                  | "\x07" <string> <!-- string -->
                  | "\x08" <double> <!-- date -->
                  | "\x09" <list>   <!-- array -->
                  | "\x10" <map>    <!-- object -->

    <byte>      ::= BYTE      <!-- 8-bit -->
    <int29>     ::= 1*4<byte> <!-- 29-bit signed integer -->
    <double>    ::= *8<byte>  <!-- 64-bit IEEE 754 floating point -->
    <utf8>      ::= 1*4<byte>

    <string>    ::= <length> *<utf8>
                  | <reference>

    <list>      ::= <int29> *<element>
                  | <reference>

    <map>       ::= <int29> *<key-value>
                  | <reference>

    <key-value> ::= <string> <element>

    <length>    ::= <int29>

    <reference> ::= <int29>
