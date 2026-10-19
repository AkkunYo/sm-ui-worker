-- Clean template names to be capability-based without redundant "默认" prefix
UPDATE inbound_templates SET name = 'VLESS Reality' WHERE id = 1;
UPDATE inbound_templates SET name = 'Hysteria 2' WHERE id = 2;
UPDATE inbound_templates SET name = 'TUIC v5' WHERE id = 4;
UPDATE inbound_templates SET name = 'Trojan Reality' WHERE id = 5;
UPDATE inbound_templates SET name = 'AnyTLS' WHERE id = 6;
