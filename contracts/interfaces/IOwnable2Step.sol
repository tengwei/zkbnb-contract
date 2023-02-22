// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IOwnable2Step {
  function owner() external returns (address);

  function pendingOwner() external returns (address);

  function transferOwnership(address recipient) external;

  function acceptOwnership() external;
}
