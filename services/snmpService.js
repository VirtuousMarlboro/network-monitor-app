const snmp = require('net-snmp');

// Common OIDs
const OIDS = {
    sysDescr: '1.3.6.1.2.1.1.1.0',
    sysName: '1.3.6.1.2.1.1.5.0',
    sysUpTime: '1.3.6.1.2.1.1.3.0',

    // Interface Table (ifTable)
    ifDescr: '1.3.6.1.2.1.2.2.1.2',
    ifType: '1.3.6.1.2.1.2.2.1.3',
    ifSpeed: '1.3.6.1.2.1.2.2.1.5',
    ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
    ifInOctets: '1.3.6.1.2.1.2.2.1.10',
    ifOutOctets: '1.3.6.1.2.1.2.2.1.16',

    // Interface X Table (ifXTable) - 64-bit counters for high speed interfaces
    ifName: '1.3.6.1.2.1.31.1.1.1.1',
    ifAlias: '1.3.6.1.2.1.31.1.1.1.18', // User-configured interface name (FortiGate uses this)
    ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
    ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
    ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15' // Speed in Mbps
};

/**
 * Create an SNMP session
 */
function createSession(host, community, version = '2c') {
    const options = {
        port: 161,
        retries: 2,
        timeout: 5000, // Increased timeout for slower devices like FortiGate
        transport: 'udp4',
        trapPort: 162,
        version: version === '1' ? snmp.Version1 : snmp.Version2c,
        backwardsGetNexts: true,
        idBitsSize: 32
    };

    return snmp.createSession(host, community, options);
}

/**
 * Get list of interfaces from a host
 * Tries multiple OIDs for compatibility with different vendors (MikroTik, FortiGate, Cisco, etc.)
 */
async function getInterfaces(host, community, version = '2c') {
    return new Promise((resolve, reject) => {
        const session = createSession(host, community, version);
        const interfaces = {};
        let scanStarted = false;

        console.log(`[SNMP Scan] Starting interface scan for ${host} (community: ${community}, version: ${version})`);

        // 1. Try ifDescr first (most common)
        session.subtree(OIDS.ifDescr, 20, (varbinds) => {
            scanStarted = true;
            // Feed Callback: Process varbinds
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) {
                    console.log(`[SNMP Scan] Varbind error for ifDescr: ${snmp.varbindError(vb)}`);
                    continue;
                }

                const ifIndex = vb.oid.split('.').pop();
                // Handle Buffer and various value types for FortiGate compatibility
                let ifName = '';
                if (Buffer.isBuffer(vb.value)) {
                    ifName = vb.value.toString('utf8').trim();
                } else if (typeof vb.value === 'string') {
                    ifName = vb.value.trim();
                } else {
                    ifName = String(vb.value).trim();
                }

                // Use index as fallback if name is empty
                if (!ifName) {
                    ifName = `Interface ${ifIndex}`;
                }

                interfaces[ifIndex] = {
                    index: parseInt(ifIndex),
                    name: ifName,
                    description: ifName,
                    status: 'unknown',
                    speed: 0,
                    type: 0
                };
            }
            console.log(`[SNMP Scan] ifDescr callback received ${varbinds.length} varbinds, total interfaces: ${Object.keys(interfaces).length}`);
        }, (error) => {
            // Done Callback for ifDescr
            if (error) {
                console.warn(`[SNMP Scan] ifDescr failed for ${host}: ${error.message}`);

                // Try ifName as fallback (some devices only expose ifName)
                console.log(`[SNMP Scan] Trying fallback ifName OID for ${host}...`);
                session.subtree(OIDS.ifName, 20, (varbinds) => {
                    for (const vb of varbinds) {
                        if (snmp.isVarbindError(vb)) continue;
                        const ifIndex = vb.oid.split('.').pop();
                        if (!interfaces[ifIndex]) {
                            interfaces[ifIndex] = {
                                index: parseInt(ifIndex),
                                name: vb.value.toString(),
                                description: vb.value.toString(),
                                status: 'unknown',
                                speed: 0,
                                type: 0
                            };
                        }
                    }
                    console.log(`[SNMP Scan] ifName fallback received ${varbinds.length} varbinds`);
                }, (fallbackError) => {
                    if (fallbackError) {
                        console.warn(`[SNMP Scan] ifName fallback also failed: ${fallbackError.message}`);
                    }
                    // Continue to get status/speed anyway
                    continueWithStatusAndSpeed(session, interfaces, host, resolve);
                });
                return;
            }

            console.log(`[SNMP Scan] ifDescr completed for ${host}, found ${Object.keys(interfaces).length} interfaces`);

            // If we got 0 interfaces from ifDescr, try ifName as well
            if (Object.keys(interfaces).length === 0) {
                console.log(`[SNMP Scan] No interfaces from ifDescr, trying ifName for ${host}...`);
                session.subtree(OIDS.ifName, 20, (varbinds) => {
                    for (const vb of varbinds) {
                        if (snmp.isVarbindError(vb)) continue;
                        const ifIndex = vb.oid.split('.').pop();
                        interfaces[ifIndex] = {
                            index: parseInt(ifIndex),
                            name: vb.value.toString(),
                            description: vb.value.toString(),
                            status: 'unknown',
                            speed: 0,
                            type: 0
                        };
                    }
                    console.log(`[SNMP Scan] ifName received ${varbinds.length} varbinds`);
                }, (ifNameError) => {
                    if (ifNameError) console.warn(`[SNMP Scan] ifName failed: ${ifNameError.message}`);
                    continueWithStatusAndSpeed(session, interfaces, host, resolve);
                });
            } else {
                continueWithStatusAndSpeed(session, interfaces, host, resolve);
            }
        });
    });
}

/**
 * Helper function to get status, speed, and better names after interface list is retrieved
 */
function continueWithStatusAndSpeed(session, interfaces, host, resolve) {
    // Check if we need better names (names are still "Interface X")
    const needsBetterNames = Object.values(interfaces).some(
        iface => iface.name.startsWith('Interface ')
    );

    if (needsBetterNames) {
        console.log(`[SNMP Scan] Trying ifName for better names on ${host}...`);
        // Try ifName first
        session.subtree(OIDS.ifName, 20, (varbinds) => {
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) continue;
                const ifIndex = vb.oid.split('.').pop();
                if (interfaces[ifIndex]) {
                    const name = extractName(vb.value);
                    if (name && !name.startsWith('Interface ')) {
                        interfaces[ifIndex].name = name;
                        interfaces[ifIndex].description = name;
                    }
                }
            }
        }, (error) => {
            if (error) console.warn(`[SNMP Scan] ifName failed for ${host}: ${error.message}`);

            // Try ifAlias (FortiGate uses this for user-configured names)
            console.log(`[SNMP Scan] Trying ifAlias for user-configured names on ${host}...`);
            session.subtree(OIDS.ifAlias, 20, (varbinds) => {
                for (const vb of varbinds) {
                    if (snmp.isVarbindError(vb)) continue;
                    const ifIndex = vb.oid.split('.').pop();
                    if (interfaces[ifIndex]) {
                        const alias = extractName(vb.value);
                        if (alias) {
                            // Prefer alias over ifName if available
                            interfaces[ifIndex].alias = alias;
                            // If name is still generic, use alias
                            if (interfaces[ifIndex].name.startsWith('Interface ')) {
                                interfaces[ifIndex].name = alias;
                                interfaces[ifIndex].description = alias;
                            }
                        }
                    }
                }
            }, (error) => {
                if (error) console.warn(`[SNMP Scan] ifAlias failed for ${host}: ${error.message}`);
                continueWithStatusAndSpeedFinal(session, interfaces, host, resolve);
            });
        });
    } else {
        continueWithStatusAndSpeedFinal(session, interfaces, host, resolve);
    }
}

/**
 * Extract name from SNMP value (handles Buffer and various formats)
 */
function extractName(value) {
    let name = '';
    if (Buffer.isBuffer(value)) {
        name = value.toString('utf8').trim();
    } else if (typeof value === 'string') {
        name = value.trim();
    } else {
        name = String(value).trim();
    }
    return name;
}

/**
 * Final step: get status and speed
 */
function continueWithStatusAndSpeedFinal(session, interfaces, host, resolve) {
    // 2. Get Interface Operational Status
    session.subtree(OIDS.ifOperStatus, 20, (varbinds) => {
        for (const vb of varbinds) {
            if (snmp.isVarbindError(vb)) continue;
            const ifIndex = vb.oid.split('.').pop();
            if (interfaces[ifIndex]) {
                interfaces[ifIndex].status = vb.value === 1 ? 'up' : 'down';
                interfaces[ifIndex].statusCode = vb.value;
            }
        }
    }, (error) => {
        if (error) console.warn(`[SNMP Scan] ifOperStatus failed for ${host}: ${error.message}`);

        // 3. Get Interface Speed (ifSpeed)
        session.subtree(OIDS.ifSpeed, 20, (varbinds) => {
            for (const vb of varbinds) {
                if (snmp.isVarbindError(vb)) continue;
                const ifIndex = vb.oid.split('.').pop();
                if (interfaces[ifIndex]) {
                    interfaces[ifIndex].speed = vb.value;
                }
            }
        }, (error) => {
            if (error) console.warn(`[SNMP Scan] ifSpeed failed for ${host}: ${error.message}`);

            // Finalize and sort
            session.close();

            const result = Object.values(interfaces)
                .sort((a, b) => a.index - b.index);

            console.log(`[SNMP Scan] Completed for ${host}: Found ${result.length} interfaces`);
            if (result.length > 0) {
                console.log(`[SNMP Scan] First interface: ${JSON.stringify(result[0])}`);
            }
            resolve(result);
        });
    });
}

/**
 * Get traffic counters for a specific interface
 * Automatically attempts to use 64-bit counters if available (for high speed links)
 * but falls back to 32-bit if needed or if not supported.
 */
async function getInterfaceTraffic(host, community, ifIndex, version = '2c') {
    return new Promise((resolve, reject) => {
        const session = createSession(host, community, version);

        // Prepare OIDs for polling
        const oids = [
            // Standard 32-bit counters
            OIDS.ifInOctets + '.' + ifIndex,
            OIDS.ifOutOctets + '.' + ifIndex,
            OIDS.ifOperStatus + '.' + ifIndex,

            // 64-bit counters (HC) - High Capacity
            OIDS.ifHCInOctets + '.' + ifIndex,
            OIDS.ifHCOutOctets + '.' + ifIndex,

            // Connection Info
            OIDS.sysUpTime
        ];

        session.get(oids, (error, varbinds) => {
            session.close();

            if (error) {
                return reject(error);
            }

            const data = {
                timestamp: Date.now(),
                ifIndex: ifIndex,
                status: 'unknown',
                sysUpTime: 0,
                inOctets: 0,
                outOctets: 0,
                is64bit: false
            };

            // Process 32-bit results first (indices 0, 1, 2)
            if (!snmp.isVarbindError(varbinds[0])) data.inOctets = parseInt(varbinds[0].value);
            if (!snmp.isVarbindError(varbinds[1])) data.outOctets = parseInt(varbinds[1].value);
            if (!snmp.isVarbindError(varbinds[2])) data.status = varbinds[2].value === 1 ? 'up' : 'down';

            // Process 64-bit results (indices 3, 4) - overwrite if valid
            // Note: net-snmp returns Buffers for 64-bit integers usually, or creates BigInt if supported
            // We check if we got valid responses for HC counters
            const hcIn = varbinds[3];
            const hcOut = varbinds[4];

            if (!snmp.isVarbindError(hcIn) && !snmp.isVarbindError(hcOut)) {
                // Check if values differ significantly from 0 or look valid
                // For simplicity in this basic monitor, if we get non-error HC vars, we try to use them
                // net-snmp returns Buffer for Counter64
                if (Buffer.isBuffer(hcIn.value)) {
                    // Convert Buffer to BigInt/Number. Careful with JS Number precision > 2^53
                    // For network traffic graphing, slight precision loss at >9 Petabytes is acceptable
                    // but we should try to keep it safe.
                    // For now, let's treat them as BigInt strings if needed, or just numbers.
                    // NOTE: This simple implementation might truncate if > 2^53.
                    // A safer way is reading bytes from buffer.
                    data.inOctets = readUInt64BE(hcIn.value);
                    data.outOctets = readUInt64BE(hcOut.value);
                    data.is64bit = true;
                }
            }

            // sysUpTime
            if (!snmp.isVarbindError(varbinds[5])) data.sysUpTime = varbinds[5].value;

            resolve(data);
        });
    });
}

/**
 * Helper to read Buffer as approx number (safe for JS math up to a point)
 * or BigInt
 */
function readUInt64BE(buffer) {
    if (typeof BigInt !== 'undefined') {
        // Use BigInt if available in Node environment
        let value = BigInt(0);
        for (let i = 0; i < buffer.length; i++) {
            value = (value << BigInt(8)) + BigInt(buffer[i]);
        }
        // Return number if it fits, else string or BigInt? 
        // Frontend charts usually need Number.
        // 2^53 is 9 PB. It's plenty for "current counter".
        // But deltas are what matter.
        // Let's return Number for compatibility, acknowledging rare overflow risk at immense scales.
        return Number(value);
    }
    // Fallback for older nodes (unlikely needed)
    return buffer.readUInt32BE(4); // Just read lower 32 bits? No, incorrect.
    // Assuming Node >= 10.4 supports BigInt
}

module.exports = {
    createSession,
    getInterfaces,
    getInterfaceTraffic
};
