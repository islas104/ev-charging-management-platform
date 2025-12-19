import { OcppProtocolVersion } from '../types/protocol-version';

export function resolveOcppProtocol(
  protocols: readonly string[] | undefined,
): OcppProtocolVersion {
  if (!protocols || protocols.length === 0) {
    return OcppProtocolVersion.OCPP_1_6; // safe default
  }

  if (protocols.includes('ocpp2.0.1')) {
    return OcppProtocolVersion.OCPP_2_0_1;
  }

  if (protocols.includes('ocpp1.6')) {
    return OcppProtocolVersion.OCPP_1_6;
  }

  return OcppProtocolVersion.OCPP_1_6;
}
