// Test preload only. Refuses every outgoing socket and reports the attempt, so a test can prove that a script stopped
// before it reached any database. It never connects anywhere.
import net from 'node:net';
import tls from 'node:tls';

const refuse = () => {
  process.stderr.write('NETWORK_ATTEMPT\n');
  throw new Error('NETWORK_ATTEMPT: outgoing connections are refused in this test');
};
net.Socket.prototype.connect = refuse;
net.connect = refuse;
net.createConnection = refuse;
tls.connect = refuse;
